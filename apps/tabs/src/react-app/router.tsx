import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "./layouts/RootLayout";

export const router = createBrowserRouter([
  { path: "/", element: <RootLayout /> },
  { path: "/about", element: <RootLayout /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
