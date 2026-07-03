import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function NoPermission() {
  const { profile, roles, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (roles.length > 0 && (profile?.tenant_id || roles.includes("super_admin"))) {
      navigate("/", { replace: true });
    }
  }, [navigate, profile?.tenant_id, roles]);

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-warning/10 border border-warning/30 grid place-items-center">
          <ShieldAlert className="h-8 w-8 text-warning" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Acesso pendente</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Sua conta <span className="font-medium text-foreground">{profile?.email}</span> ainda não foi
            vinculada a uma empresa ou não tem um papel atribuído.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Peça ao administrador da sua empresa para enviar um convite, ou aguarde a liberação.
          </p>
        </div>
        <Button variant="outline" onClick={() => signOut()}>
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </div>
    </div>
  );
}
