import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

setBaseUrl(import.meta.env.VITE_API_BASE_URL || null);
setAuthTokenGetter(import.meta.env.VITE_ADMIN_API_KEY ? () => import.meta.env.VITE_ADMIN_API_KEY : null);

createRoot(document.getElementById("root")!).render(<App />);
