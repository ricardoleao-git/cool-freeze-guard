import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDemo } from "@/lib/demo-store";

export function SoundToggle() {
  const { soundEnabled, setSoundEnabled } = useDemo();
  return (
    <Button variant="ghost" size="sm" onClick={() => setSoundEnabled(!soundEnabled)} title={soundEnabled ? "Desativar alertas sonoros" : "Ativar alertas sonoros"}>
      {soundEnabled ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );
}
