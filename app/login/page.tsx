import { signInWithGoogle } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't on the Five Hughes team list.",
  oauth: "Google sign-in failed. Try again.",
  missing_code: "Google sign-in was interrupted. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Hughes Marketing</CardTitle>
          <CardDescription>Sign in with your team Google account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ERRORS[error] ?? "Sign-in failed."}
            </p>
          )}
          <form action={signInWithGoogle}>
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
