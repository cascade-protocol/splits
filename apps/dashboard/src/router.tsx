import { createBrowserRouter } from "react-router";
import { RootLayout } from "./layouts/RootLayout";

export const router = createBrowserRouter([
  {
    path: "*",
    element: <RootLayout />,
  },
]);
