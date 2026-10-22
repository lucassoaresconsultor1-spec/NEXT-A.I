# Contrato das telas de fila — m13b v1

## Objetivo e escopo
Entregar a tela de operação do tablet e a visão do gerente para a fila da loja, usando m13a/m33 integrados. Arquivos novos em `src/app/(app)/fila/**` e na rota pública do tablet; o dono inclui a rota pública no proxy. Não alterar serviços, permissões, schema ou proxy.

## APIs reais
```ts
// src/server/devices/service.ts
createDevice(context, rawInput); renewPairingCode(context, deviceId);
revokeDevice(context, deviceId); listDevices(context, filters?);
pairDevice(rawCode, ip); deviceFromToken(token); deviceMembers(token);
deviceActor(token, { membershipId, pin });
// src/server/devices/pin.ts
setOwnQueuePin(context, rawInput); clearQueuePin(context, membershipId);
// src/server/queue/service.ts
registerArrival(context, rawInput); setPresence(context, rawInput);
callNext(context, { storeId }); assignManual(context, entryId, rawInput);
finishAttendance(context, entryId, rawInput); abandonEntry(context, entryId, rawInput);
getQueue(context, storeId); queueStats(context, rawFilters);
```
Chegada valida `arrivalSchema` (inclui `departmentId` opcional); demais entradas usam `presenceSchema`, `manualSchema`, `finishSchema`, `abandonSchema` e `statsSchema` em `src/server/queue/schemas.ts`. Setores já configurados são consumidos como IDs válidos; não criar API de setor.

## Fluxos
- Tablet em rota pública: parear código de uso único, guardar token apenas em cookie `HttpOnly`, `Secure` em produção e `SameSite` adequado; recuperar aparelho por `deviceFromToken`. Permitir selecionar membro de `deviceMembers`, validar PIN via `deviceActor` e usar o contexto resultante, limitado à fila e à loja do aparelho.
- Registrar chegada com setor opcional via `registerArrival`; exibir senha retornada. Operação autenticada chama próximo (`callNext`) ou faz atribuição manual somente quando permitida; consulta fila via `getQueue`; encerra via `finishAttendance` e registra desistência via `abandonEntry`. Atualizar tela com dados retornados pelo serviço.
- Visão gerente usa `getQueue`/`queueStats` e gestão de aparelhos `listDevices`, `createDevice`, `renewPairingCode`, `revokeDevice`. Configuração de PIN permanece nas APIs de PIN existentes.

## Permissões e aceite
- `queue.read` para leitura, `queue.operate` para chegada, rodízio e operações correspondentes, `queue.assign_manual` para atribuição manual; `queue.devices.manage` para aparelhos e gestão permitida de PIN. `deviceActor` restringe permissões e loja; não elevar privilégios no tablet.
- Páginas/actions de sessão chamam `requireTenantContext()`; fluxos do dispositivo validam token e membro com serviços reais. Nunca confiar em `storeId` enviado pelo tablet: usar a loja do aparelho. Não colocar token em localStorage, URL, logs ou conteúdo renderizado.
- Aceite: pareamento e PIN inválidos/expirados são recusados; membro escolhe setor na chegada; rodízio, atendimento, encerramento e visão gerencial refletem serviço; aparelho revogado perde acesso; estados de erro/vazio acessíveis. Nenhuma fila ou estatística fictícia.
