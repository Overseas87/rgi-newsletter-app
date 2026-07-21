import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { getEditorIdToken } from "@/lib/editor-auth";

setBaseUrl(import.meta.env.VITE_API_BASE_URL || null);
setAuthTokenGetter(getEditorIdToken);

createRoot(document.getElementById("root")!).render(<App />);
