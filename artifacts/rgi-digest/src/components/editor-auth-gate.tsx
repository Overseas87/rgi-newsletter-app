import { useState, type FormEvent, type ReactNode } from "react";
import { LockKeyhole, LogOut } from "lucide-react";
import { useEditorAuth } from "@/lib/editor-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function EditorAuthGate({ children }: { children: ReactNode }) {
  const auth = useEditorAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.loading) {
    return (
      <div className="space-y-3 py-16" data-testid="editor-auth-loading">
        <Skeleton className="mx-auto h-10 w-72" />
        <Skeleton className="mx-auto h-40 w-full max-w-md" />
      </div>
    );
  }

  // Authentication is enforced by the API. When public Firebase client
  // configuration is absent, allow the route to render its explicit 401/503
  // state instead of inventing a browser-side access fallback.
  if (!auth.configured) {
    return (
      <>
        {auth.configurationError ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            Firebase editor sign-in configuration is invalid. Protected API
            requests remain fail-closed.
          </div>
        ) : null}
        {children}
      </>
    );
  }

  if (!auth.user) {
    const submit = async (event: FormEvent) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await auth.signIn(email.trim(), password);
      } catch {
        setError(
          "Sign-in failed. Verify the provisioned editor account and try again.",
        );
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="py-16">
        <Card className="mx-auto max-w-md">
          <CardContent className="space-y-4 p-6">
            <div className="text-center">
              <LockKeyhole className="mx-auto h-9 w-9 text-muted-foreground" />
              <h1 className="mt-3 text-xl font-semibold">RGI editor sign-in</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Use a provisioned Firebase account. Account creation and
                recovery are administered outside this application.
              </p>
            </div>
            <form className="space-y-3" onSubmit={submit}>
              <div>
                <Label htmlFor="editor-auth-email">Email</Label>
                <Input
                  id="editor-auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  data-testid="editor-auth-email"
                />
              </div>
              <div>
                <Label htmlFor="editor-auth-password">Password</Label>
                <Input
                  id="editor-auth-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  data-testid="editor-auth-password"
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
                data-testid="editor-auth-sign-in"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid="editor-auth-signed-in"
      >
        <span>Signed in as {auth.user.email ?? auth.user.uid}</span>
        <Button variant="ghost" size="sm" onClick={() => void auth.signOut()}>
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
      {children}
    </>
  );
}
