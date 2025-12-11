import { Link } from "@tanstack/react-router";
import { Plus, Server, Activity, DollarSign } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

interface Service {
  id: string;
  name: string;
  status: "online" | "offline";
  price: string;
  totalCalls: number;
  totalRevenue: string;
}

export function Dashboard() {
  // TODO: Fetch services from server function
  const services: Service[] = [];

  return (
    <div className="container mx-auto px-4 py-6 md:px-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Manage your MCP services and track revenue
          </p>
        </div>
        <Button asChild>
          <Link to="/services/new">
            <Plus className="mr-2 h-4 w-4" />
            New Service
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Server className="h-4 w-4" />}
          label="Services"
          value={services.length.toString()}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Total Calls"
          value="0"
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Revenue"
          value="$0.00"
        />
      </div>

      {/* Services List */}
      <Card>
        <CardHeader>
          <CardTitle>My Services</CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <Empty>
              <EmptyMedia variant="icon">
                <Server className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No services yet</EmptyTitle>
              <EmptyDescription>
                Create your first paid MCP endpoint to get started.
              </EmptyDescription>
              <Button asChild>
                <Link to="/services/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Service
                </Link>
              </Button>
            </Empty>
          ) : (
            <div className="divide-y divide-border">
              {services.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-sm">{label}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ServiceRow({ service }: { service: Service }) {
  return (
    <Link
      to="/services/$id"
      params={{ id: service.id }}
      className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-2 h-2 rounded-full ${
            service.status === "online" ? "bg-green-500" : "bg-muted-foreground"
          }`}
        />
        <div>
          <div className="font-medium">{service.name}</div>
          <div className="text-sm text-muted-foreground">
            {service.name}.mcps.cascade.fyi
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-medium">{service.totalCalls} calls</div>
        <div className="text-sm text-muted-foreground">
          {service.price}/call
        </div>
      </div>
    </Link>
  );
}
