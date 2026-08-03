ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS portal_password_hash text,
  ADD COLUMN IF NOT EXISTS portal_password_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_must_change_password boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS portal_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_login_at timestamptz;

-- CPF derivado do numero de registro quando ele for um CPF (11 digitos)
UPDATE public.employees
   SET cpf = regexp_replace(registration_number, '\D', '', 'g')
 WHERE cpf IS NULL
   AND length(regexp_replace(registration_number, '\D', '', 'g')) = 11;

CREATE INDEX IF NOT EXISTS employees_cpf_idx ON public.employees (cpf);