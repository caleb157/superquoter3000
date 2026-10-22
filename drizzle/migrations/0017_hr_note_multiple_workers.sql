ALTER TABLE public.hr_notes ADD COLUMN employees jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.hr_notes SET employees = jsonb_build_array(jsonb_build_object('id', employee_odoo_id, 'name', employee_name));
ALTER TABLE public.hr_notes ADD CONSTRAINT hr_notes_employees_array CHECK (jsonb_typeof(employees) = 'array');
COMMENT ON COLUMN public.hr_notes.employees IS 'Selected Odoo workers (id and name); legacy employee columns mirror the first worker for compatibility.';