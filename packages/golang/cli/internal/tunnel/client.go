// Package tunnel provides a WebSocket client that connects to the
// TunnelRelay Durable Object and forwards MCP requests to a local server.
package tunnel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/cascade-protocol/splits/cli/internal/config"
	"github.com/coder/websocket"
	"github.com/fatih/color"
)

// Request represents an incoming tunnel request.
type Request struct {
	Type    string            `json:"type"`
	ID      string            `json:"id"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Response represents an outgoing tunnel response.
type Response struct {
	Type    string            `json:"type"`
	ID      string            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Options configures the tunnel client.
type Options struct {
	Token        *config.ParsedToken
	LocalURL     string
	Debug        bool
	OnConnect    func()
	OnDisconnect func(code int, reason string)
	OnError      func(err error)
	OnRequest    func(method, path string)
}

// Client manages the WebSocket connection to the tunnel relay.
type Client struct {
	opts              Options
	conn              *websocket.Conn
	mu                sync.Mutex
	reconnectAttempts int
	maxReconnects     int
	reconnectDelay    time.Duration
	httpClient        *http.Client
}

// NewClient creates a new tunnel client.
func NewClient(opts Options) *Client {
	return &Client{
		opts:           opts,
		maxReconnects:  10,
		reconnectDelay: time.Second,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Connect establishes and maintains the WebSocket connection.
func (c *Client) Connect(ctx context.Context) error {
	return c.connectWithRetry(ctx)
}

func (c *Client) connectWithRetry(ctx context.Context) error {
	for {
		err := c.dial(ctx)
		if err == nil {
			c.reconnectAttempts = 0
			if c.opts.OnConnect != nil {
				c.opts.OnConnect()
			}

			// Start message loop
			err = c.messageLoop(ctx)
		}

		// Check if context was cancelled
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// Handle disconnection
		if c.opts.OnDisconnect != nil {
			c.opts.OnDisconnect(1006, err.Error())
		}

		// Check if we should retry
		c.reconnectAttempts++
		if c.reconnectAttempts > c.maxReconnects {
			return fmt.Errorf("max reconnection attempts reached: %w", err)
		}

		// Calculate backoff delay
		delay := c.reconnectDelay * time.Duration(1<<(c.reconnectAttempts-1))
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}

		color.Yellow("Reconnecting in %v (attempt %d/%d)...",
			delay, c.reconnectAttempts, c.maxReconnects)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
			// Continue to retry
		}
	}
}

func (c *Client) dial(ctx context.Context) error {
	if c.opts.Debug {
		color.HiBlack("Connecting to %s...", c.opts.Token.TunnelURL)
	}

	headers := http.Header{}
	headers.Set("X-SERVICE-TOKEN", c.opts.Token.Raw)

	conn, _, err := websocket.Dial(ctx, c.opts.Token.TunnelURL, &websocket.DialOptions{
		HTTPHeader: headers,
	})
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	return nil
}

func (c *Client) messageLoop(ctx context.Context) error {
	// Start ping loop
	pingCtx, cancelPing := context.WithCancel(ctx)
	defer cancelPing()

	go c.pingLoop(pingCtx)

	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			return err
		}

		var req Request
		if err := json.Unmarshal(data, &req); err != nil {
			if c.opts.Debug {
				color.Red("Error parsing message: %v", err)
			}
			continue
		}

		if req.Type == "request" {
			go c.handleRequest(ctx, req)
		}
	}
}

func (c *Client) pingLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			conn := c.conn
			c.mu.Unlock()

			if conn != nil {
				if err := conn.Ping(ctx); err != nil {
					if c.opts.Debug {
						color.Red("Ping failed: %v", err)
					}
				}
			}
		}
	}
}

func (c *Client) handleRequest(ctx context.Context, req Request) {
	if c.opts.Debug {
		color.Blue("← %s %s", req.Method, req.Path)
	}

	if c.opts.OnRequest != nil {
		c.opts.OnRequest(req.Method, req.Path)
	}

	// Forward to local MCP server
	localURL, err := url.JoinPath(c.opts.LocalURL, req.Path)
	if err != nil {
		c.sendErrorResponse(ctx, req.ID, 502, "Invalid path")
		return
	}

	var body io.Reader
	if req.Method != "GET" && req.Method != "HEAD" && req.Body != "" {
		body = bytes.NewBufferString(req.Body)
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, localURL, body)
	if err != nil {
		c.sendErrorResponse(ctx, req.ID, 502, err.Error())
		return
	}

	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		if c.opts.Debug {
			color.Red("Error forwarding request: %v", err)
		}
		c.sendErrorResponse(ctx, req.ID, 502, err.Error())
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.sendErrorResponse(ctx, req.ID, 502, err.Error())
		return
	}

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[k] = v[0]
		}
	}

	tunnelResp := Response{
		Type:    "response",
		ID:      req.ID,
		Status:  resp.StatusCode,
		Headers: respHeaders,
		Body:    string(respBody),
	}

	if c.opts.Debug {
		color.Green("→ %d", resp.StatusCode)
	}

	c.sendResponse(ctx, tunnelResp)
}

func (c *Client) sendErrorResponse(ctx context.Context, id string, status int, message string) {
	errBody, _ := json.Marshal(map[string]string{
		"error":   "Local server error",
		"message": message,
	})

	resp := Response{
		Type:    "response",
		ID:      id,
		Status:  status,
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    string(errBody),
	}

	c.sendResponse(ctx, resp)
}

func (c *Client) sendResponse(ctx context.Context, resp Response) {
	data, err := json.Marshal(resp)
	if err != nil {
		if c.opts.OnError != nil {
			c.opts.OnError(err)
		}
		return
	}

	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()

	if conn != nil {
		if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
			if c.opts.OnError != nil {
				c.opts.OnError(err)
			}
		}
	}
}

// Close closes the WebSocket connection.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		return c.conn.Close(websocket.StatusNormalClosure, "client closing")
	}
	return nil
}
