-- BR-061: respostas/solicitações de encaminhamento de demandas internas.
-- Não altera bacio_demanda_respostas nem dados de lojas.
create table if not exists public.bacio_demanda_entregas_internas (
  id uuid primary key default gen_random_uuid(),
  demanda_id uuid not null references public.bacio_demandas(id) on delete restrict,
  usuario_email text not null,
  status text not null check (status in ('respondido','encaminhamento_solicitado')),
  mensagem text not null check (char_length(mensagem) between 3 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists bacio_entregas_internas_demanda_data_idx
  on public.bacio_demanda_entregas_internas (demanda_id, created_at desc);
alter table public.bacio_demanda_entregas_internas enable row level security;
-- Sem políticas de leitura/gravação direta para navegadores: ações sempre pelo Apps Script com autenticação.
revoke all on table public.bacio_demanda_entregas_internas from anon, authenticated, public;
grant select, insert on table public.bacio_demanda_entregas_internas to service_role;
comment on table public.bacio_demanda_entregas_internas is
 'BR-061: histórico imutável de respostas internas; acesso pelo backend do Bacio Conecta.';
