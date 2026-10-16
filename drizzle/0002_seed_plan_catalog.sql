-- Reference data: initial plan catalog. Names, limits and features are
-- commercial HYPOTHESES (PRODUCT.md), not prices or a contract. Change them
-- with a new migration; existing organizations keep their plan_key.
INSERT INTO "plans" ("key", "name", "description", "max_stores", "max_members") VALUES
  ('essencial', 'Essencial', 'Uma loja, PDV, produtos, estoque e relatórios básicos.', 1, 10),
  ('profissional', 'Profissional', 'Gestão avançada: metas, comissões, fila de atendimento, relatórios avançados e alertas.', 1, 30),
  ('inteligencia', 'Inteligência', 'Agente de IA, relatórios conversacionais e alertas inteligentes, com limites de uso.', 1, 30),
  ('rede', 'Rede', 'Múltiplas lojas, consolidação regional, comparativos e gestão centralizada.', NULL, NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "plan_features" ("plan_key", "feature")
SELECT p.key, f.feature
FROM "plans" p
JOIN (VALUES
  ('pos', 1), ('inventory', 1), ('basic_reports', 1),
  ('targets_commissions', 2), ('service_queue', 2), ('advanced_reports', 2), ('alerts', 2),
  ('ai_assistant', 3), ('ai_reports', 3),
  ('multi_store', 4), ('regional_consolidation', 4)
) AS f(feature, tier) ON f.tier <= CASE p.key
  WHEN 'essencial' THEN 1 WHEN 'profissional' THEN 2 WHEN 'inteligencia' THEN 3 WHEN 'rede' THEN 4 END
WHERE p.key IN ('essencial', 'profissional', 'inteligencia', 'rede')
ON CONFLICT DO NOTHING;
