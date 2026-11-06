"use client";
import { useActionState } from "react";
import { setupAction } from "../actions";

export default function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, null as null | { error?: string });
  return (
    <form action={action}>
      {state?.error && <div className="notice danger flash" role="alert"><p>{state.error}</p></div>}
      <label className="field"><span className="label">Jeton d&apos;installation (ADMIN_SETUP_TOKEN)</span><input type="password" name="token" required /></label>
      <label className="field"><span className="label">Nom</span><input type="text" name="name" required /></label>
      <label className="field"><span className="label">Email</span><input type="email" name="email" autoComplete="username" required /></label>
      <label className="field"><span className="label">Mot de passe (12 caractères min.)</span><input type="password" name="password" minLength={12} autoComplete="new-password" required /></label>
      <label className="field"><span className="label">Confirmer</span><input type="password" name="password2" minLength={12} autoComplete="new-password" required /></label>
      <button className="btn" disabled={pending}>Créer le compte</button>
    </form>
  );
}
