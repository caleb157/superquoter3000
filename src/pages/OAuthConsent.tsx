import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

type ClientInfo = {
  name?: string;
  logo_uri?: string;
  client_uri?: string;
};

type AuthorizationDetails = {
  client?: ClientInfo;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};

export default function OAuthConsent() {
  useDocumentTitle("Authorize app");
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const anyData = data as any;
      const immediate = anyData?.redirect_url ?? anyData?.redirect_to;
      if (immediate && !anyData?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(anyData);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const anyData = data as any;
    const target = anyData?.redirect_url ?? anyData?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <CardTitle>Authorize application</CardTitle>
          <CardDescription>
            {details?.client?.name
              ? `${details.client.name} is requesting access to your Product HQ account.`
              : "An application is requesting access to your Product HQ account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
          {!details && !error && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          )}
          {details && (
            <>
              <p className="text-sm text-muted-foreground">
                Approving lets this app read your data through Product HQ's
                agent-integration tools, as you. It runs under your usual
                permissions — anything you can't see, it can't see.
              </p>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(true)}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  Deny
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
