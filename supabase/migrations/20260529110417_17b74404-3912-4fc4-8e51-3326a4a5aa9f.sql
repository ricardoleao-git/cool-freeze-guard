-- Buckets públicos servem arquivos via CDN sem precisar de policy SELECT em storage.objects.
-- Remover a SELECT broad elimina o warning de listing sem quebrar acesso por URL pública.

DROP POLICY IF EXISTS "Employee avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "demo read attachments" ON storage.objects;

-- Mantém acesso de leitura autenticada (caso já exista alguma policy de auth ela permanece;
-- aqui criamos uma para garantir leitura por usuários logados nos dois buckets).
CREATE POLICY "avatars read authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('employee-avatars','occurrence-attachments'));