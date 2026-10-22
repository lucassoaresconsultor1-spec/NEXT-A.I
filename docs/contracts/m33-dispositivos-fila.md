# Contrato do módulo `m33-dispositivos-fila` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (autenticação de aparelho). Nível **A**. Migração **17ª** (`0039`/`0040`). Implementa o ADR-011 sobre os serviços do m13a, sem alterá-los.

## 1. Objetivo
Tablet da entrada pareado com a loja: o gerente gera um **código de uso único** (10 min); o tablet o troca por um **token de aparelho** (guardado só como hash, revogável); cada ação no tablet é feita por um membro identificado por **PIN de fila** (scrypt, limite de tentativas por aparelho e por membro), com as permissões dele **restritas à fila e à loja do tablet**.

## 2. Fora de escopo
Telas (m13b), rota pública do tablet no proxy (o Maestro acrescenta o caminho que a tela usar), cache offline.

## 3. Allowlist
`src/db/schema/devices.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/devices/service.ts`, `src/server/devices/pin.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/devices.test.ts`, `src/db/schema/queue.ts`, `src/server/queue/schemas.ts`, `src/server/queue/service.ts`, `src/server/queue/departments.ts`, `tests/integration/queue.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m33-dispositivos-fila.md`.

## 4. Interface
```ts
// service.ts (gestão, sessão normal; queue.devices.manage na loja do escopo)
createDevice(context, { storeId, name }): Promise<{ id; pairingCode; expiresAt }>   // código mostrado uma vez
renewPairingCode(context, deviceId): Promise<{ pairingCode; expiresAt }>             // aparelho ainda não pareado
revokeDevice(context, deviceId): Promise<void>
listDevices(context, { storeId? })
pairDevice(code, ip): Promise<{ token; deviceId }>                                   // sem sessão; limite por IP
deviceFromToken(token): Promise<Device | null>                                        // ativo e não revogado; atualiza last_seen
deviceMembers(token): Promise<{ membershipId; name }[]>                               // membros da loja com PIN e queue.read
deviceActor(token, { membershipId, pin }): Promise<TenantContext>                     // contexto restrito para chamar o m13a
// pin.ts (sessão normal)
setOwnQueuePin(context, { pin }); clearQueuePin(context, membershipId)               // próprio (queue.read) / queue.devices.manage, nível inferior
```

## 5. Dados
`queue_devices` (loja, nome, situação `pending`/`active`/`revoked`, pareado/revogado/visto por último, criado por; FORCE RLS). `queue_pins` (membro → hash scrypt do PIN; FORCE RLS). `device_credentials` (global, sem dado de negócio: hash → empresa e aparelho, tipo `pairing` com validade ou `device`), como `sessions` e `payment_provider_references`.

## 6. Regras
- Código: 8 caracteres de alfabeto sem ambíguos, HMAC com o segredo da aplicação, uso único, 10 minutos; renovar invalida o anterior. Token: 256 bits, SHA-256. Revogar apaga as credenciais.
- PIN: 6 dígitos, recusa sequências e repetições; tentativas: 5 por membro e 20 por aparelho a cada 15 min (contam só as falhas); bloqueado = mensagem genérica.
- `deviceActor`: o membro precisa estar ativo, alcançar a loja do tablet e ter `queue.read`; o contexto devolvido tem só as permissões de fila do membro (`queue.read`, `queue.operate`, `queue.assign_manual`) e o escopo = a loja do tablet. Nenhuma outra permissão vale pelo tablet.
- Permissão nova `queue.devices.manage` (Gerente de loja; Dono/Admin). Auditoria: `queue_device.created|pairing_renewed|paired|revoked`, `queue_pin.set|cleared` (sem o PIN).

## 9. Critérios de aceite
Integração: parear com código válido uma vez (segunda vez, expirado, de outra loja revogada = recusado); token só como hash; revogação corta o aparelho; PIN errado conta e bloqueia, certo libera; ator do tablet não tem permissões fora da fila nem outra loja; recepção chama pelo tablet e o vendedor encerra o próprio atendimento com PIN; isolamento.

## 10. Junto deste módulo: setor/especialidade na fila (m13a v2)
Setor e especialidade = departamentos da empresa. `salesperson_departments` liga vendedor × departamento (`setSalespersonDepartments(context, salespersonId, { departmentIds })`, `salespeople.manage`); a chegada pode pedir um setor (`departmentId`) e o rodízio então só chama vendedores daquele setor (sem cair no rodízio geral; a atribuição manual continua possível). Mesma migração `0039`/`0040`.
