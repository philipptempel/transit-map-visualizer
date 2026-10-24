import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { MapPage } from "@/components/MapPage";

// No StrictMode: it mounts effects twice in development, and the renderer has no
// teardown, so a second renderer would end up drawing on the same canvas.
createRoot(document.getElementById("root")!).render(<MapPage />);
