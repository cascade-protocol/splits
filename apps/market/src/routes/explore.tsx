import { createFileRoute, Link } from "@tanstack/react-router";
import { Server, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { getPublicServices } from "@/server/services";

export const Route = createFileRoute("/explore")({
  ssr: true, // SSR for SEO
  loader: () => getPublicServices({ data: { limit: 50 } }),
  component: ExplorePage,
});

function ExplorePage() {
  const services = Route.useLoaderData();

  return (
    <div className="container mx-auto px-4 py-8 md:px-6">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Explore MCP Services</h1>
        <p className="text-muted-foreground">
          Discover paid MCP endpoints from the community
        </p>
      </div>

      {/* Services Grid */}
      {services.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <Empty>
              <EmptyMedia variant="icon">
                <Server className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No services available</EmptyTitle>
              <EmptyDescription>
                Be the first to publish a paid MCP endpoint!
              </EmptyDescription>
              <Button asChild>
                <Link to="/services/new">Create Service</Link>
              </Button>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  service,
}: {
  service: {
    id: string;
    name: string;
    price: string;
    status: string;
    total_calls: number;
    total_revenue: string;
  };
}) {
  const priceDisplay = `$${(Number(service.price) / 1_000_000).toFixed(6)}`;

  return (
    <Card className="hover:border-foreground/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{service.name}</CardTitle>
          <Badge variant="default">Online</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {service.name}.mcps.market.cascade.fyi
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Price per call</span>
          <span className="font-medium">{priceDisplay}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total calls</span>
          <span className="font-medium">
            {service.total_calls.toLocaleString()}
          </span>
        </div>
        <Button variant="outline" className="w-full" asChild>
          <a
            href={`https://${service.name}.mcps.market.cascade.fyi`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View Endpoint
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
