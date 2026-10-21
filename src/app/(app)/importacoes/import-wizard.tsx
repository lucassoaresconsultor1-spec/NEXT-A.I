"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { idleState, type ActionState } from "@/lib/action-state";
import type { ImportField, ImportKind } from "@/server/imports/schemas";
import { createImportAction, readCsvHeadersAction, type HeaderActionState } from "./actions";

type Store = { id: string; name: string };
type KindLabels = Record<ImportKind, string>;

export function ImportWizard({ allowedKinds, fields, kindLabels, stores }: { allowedKinds: ImportKind[]; fields: Record<ImportKind, ImportField[]>; kindLabels: KindLabels; stores: Store[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<ImportKind>(allowedKinds[0] ?? "products");
  const [storeId, setStoreId] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<"file" | "mapping">("file");
  const [state, setState] = useState<ActionState>(idleState);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current) return;
    setPending(true);
    setState(idleState);
    const formData = new FormData(formRef.current);
    try {
      if (stage === "file") {
        const result: HeaderActionState = await readCsvHeadersAction(formData);
        setState(result);
        if (result.status === "success" && result.kind && result.headers) {
          setKind(result.kind);
          setHeaders(result.headers);
          setMapping(result.suggestedMapping ?? {});
          setFileName(result.fileName ?? fileName);
          setStage("mapping");
        }
      } else {
        const result = await createImportAction(formData);
        setState(result);
        if (result.status === "success" && result.importId) router.push(`/importacoes/${result.importId}`);
      }
    } catch {
      setState({ status: "error", message: "Não foi possível concluir a operação. Tente novamente." });
    } finally {
      setPending(false);
    }
  }

  function changeFile(name: string) {
    setFileName(name);
    setHeaders([]);
    setMapping({});
    setStage("file");
    setState(idleState);
  }

  if (allowedKinds.length === 0) return <Notice tone="info" title="Seu perfil não tem permissão para preparar uma importação." />;
  const activeFields = fields[kind];

  return <form ref={formRef} onSubmit={submit} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message}>{Object.values(state.fieldErrors ?? {}).flat().map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}</Notice> : null}
    <div>
      {stage === "file" ? <>
        <Field label="Tipo de importação" error={state.fieldErrors?.kind} required>{(props) => <Select {...props} name="kind" value={kind} onChange={(event) => { setKind(event.currentTarget.value as ImportKind); setStoreId(""); }} required>{allowedKinds.map((value) => <option value={value} key={value}>{kindLabels[value]}</option>)}</Select>}</Field>
        {kind === "opening_stock" ? <Field label="Loja do saldo inicial" error={state.fieldErrors?.storeId} required>{(props) => <Select {...props} name="storeId" value={storeId} onChange={(event) => setStoreId(event.currentTarget.value)} required><option value="">Selecione uma loja</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</Field> : <input type="hidden" name="storeId" value="" />}
      </> : <><input type="hidden" name="kind" value={kind} /><input type="hidden" name="storeId" value={kind === "opening_stock" ? storeId : ""} /><p className="mb-3 text-sm text-ink-muted">{kindLabels[kind]} · {fileName}. Confira o mapeamento das colunas antes de criar a prévia.</p></>}
    </div>
    <Field label="Arquivo CSV" error={state.fieldErrors?.file} hint={stage === "file" ? "Até 2 MB e 5.000 linhas. Use um arquivo CSV em UTF-8." : "O arquivo será enviado ao servidor junto com o mapeamento."} required>{(props) => <Input {...props} name="file" type="file" accept=".csv,text/csv" onChange={(event) => changeFile(event.currentTarget.files?.[0]?.name ?? "")} required />}</Field>
    {stage === "file" ? <Button type="submit" disabled={pending}>{pending ? "Lendo cabeçalho…" : "Continuar para o mapeamento"}</Button> : <>
      {activeFields.map((field: ImportField) => <Field key={field.key} label={field.label} required={field.required} error={state.fieldErrors?.[`mapping.${field.key}`]}>{(props) => <Select {...props} name={`mapping.${field.key}`} value={mapping[field.key] ?? ""} required={field.required} onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.currentTarget.value }))}><option value="">{field.required ? "Selecione uma coluna" : "Não importar este campo"}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</Select>}</Field>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { setStage("file"); setState(idleState); }}>Voltar</Button><Button type="submit" disabled={pending}>{pending ? "Validando prévia…" : "Criar prévia"}</Button></div>
    </>}
  </form>;
}



