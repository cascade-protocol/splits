// Cascade CLI
//
// Connect your local MCP server to Cascade Market.
//
// Usage:
//
//	cascade --token <token> <local-url>
//
// Example:
//
//	cascade --token csc_xxxxx localhost:3000
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/cascade-protocol/splits/cli/internal/config"
	"github.com/cascade-protocol/splits/cli/internal/tunnel"
	"github.com/fatih/color"
	"github.com/urfave/cli/v3"
)

// Set by goreleaser ldflags
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

// makeFlags creates a new set of flags (avoids shared state issues)
func makeFlags() []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{
			Name:     "token",
			Aliases:  []string{"t"},
			Usage:    "Service token from Cascade Market",
			Required: true,
			Sources:  cli.EnvVars("CASCADE_TOKEN"),
		},
		&cli.BoolFlag{
			Name:    "debug",
			Aliases: []string{"d"},
			Usage:   "Enable debug output",
		},
	}
}

// makeArgs creates a new set of arguments (avoids shared state issues)
func makeArgs() []cli.Argument {
	return []cli.Argument{
		&cli.StringArg{
			Name:      "local-url",
			UsageText: "Local MCP server URL (e.g., localhost:3000)",
		},
	}
}

func main() {
	cmd := &cli.Command{
		Name:      "cascade",
		Usage:     "Connect your local MCP server to Cascade Market",
		Version:   version,
		Flags:     makeFlags(),
		Arguments: makeArgs(),
		Action:    runServe,
		Commands: []*cli.Command{
			{
				Name:      "serve",
				Usage:     "Connect your local MCP server to Cascade Market (explicit)",
				Arguments: makeArgs(),
				Action:    runServe,
				// Note: Flags are inherited from parent as "global options"
			},
		},
	}

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		color.Red("Error: %v", err)
		os.Exit(1)
	}
}

func runServe(ctx context.Context, cmd *cli.Command) error {
	rawToken := cmd.String("token")
	debug := cmd.Bool("debug")
	localURL := cmd.StringArg("local-url")

	if localURL == "" {
		return fmt.Errorf("local-url argument is required")
	}

	// Parse token
	token, err := config.ParseToken(rawToken)
	if err != nil {
		color.Red("Error: Invalid service token")
		color.New(color.FgHiBlack).Println("Token should start with 'csc_' and contain valid service data.")
		return err
	}

	// Normalize local URL
	if !strings.HasPrefix(localURL, "http") {
		localURL = "http://" + localURL
	}

	// Print header
	fmt.Println()
	color.New(color.Bold).Println("Cascade MCP Tunnel")
	color.New(color.FgHiBlack).Println(strings.Repeat("─", 40))
	fmt.Printf("%s %s\n", color.CyanString("Service:"), token.ServiceName)
	fmt.Printf("%s %s\n", color.CyanString("Local:"), localURL)
	fmt.Printf("%s $%.6f/call\n", color.CyanString("Price:"), float64(token.Payload.Price)/1_000_000)
	color.New(color.FgHiBlack).Println(strings.Repeat("─", 40))
	fmt.Println()

	// Setup signal handling for graceful shutdown
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		color.Yellow("\nDisconnecting...")
		cancel()
	}()

	// Create and run tunnel client
	client := tunnel.NewClient(tunnel.Options{
		Token:    token,
		LocalURL: localURL,
		Debug:    debug,
		OnConnect: func() {
			color.Green("✓ Connected to Cascade Market")
			color.New(color.FgHiBlack).Println("  Your MCP is now available at:")
			fmt.Printf("  https://%s.mcps.market.cascade.fyi\n", token.ServiceName)
			fmt.Println()
			color.New(color.FgHiBlack).Println("Press Ctrl+C to disconnect")
			fmt.Println()
		},
		OnDisconnect: func(code int, reason string) {
			color.Yellow("Disconnected (%d: %s)", code, reason)
		},
		OnError: func(err error) {
			color.Red("Error: %v", err)
		},
		OnRequest: func(method, path string) {
			if !debug {
				timestamp := color.HiBlackString("[%s]", timeNow())
				fmt.Printf("%s %s %s\n", timestamp, color.BlueString(method), path)
			}
		},
	})

	return client.Connect(ctx)
}

func timeNow() string {
	return time.Now().Format("15:04:05")
}
