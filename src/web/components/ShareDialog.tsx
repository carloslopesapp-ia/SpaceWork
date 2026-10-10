import { useEffect, useRef, useState } from "react";
import { formatDate } from "../../shared/format";
import type { FileItem } from "../../shared/types";
import { errorMessage } from "../api";
import { shareUrl, useCreateShare, useRevokeShare, useShares } from "../shares";
import { Button } from "./Button";
import { Loading } from "./Loading";
import { Message } from "./Message";
import { Modal } from "./Modal";

const DAY_MS = 86_400_000;

/** `days: null` = o link não expira. */
const VALIDITIES = [
  { label: "Sem validade", days: null },
  { label: "1 dia", days: 1 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
] as const;

interface CreatedLink {
  /** O id da partilha: revogá-la tira o endereço do ecrã (já não funciona). */
  id: string;
  url: string;
  expiresAt: number | null;
}

const validityText = (expiresAt: number | null) => (expiresAt === null ? "sem validade" : `válido até ${formatDate(expiresAt)}`);

/**
 * Os links públicos de um ficheiro: criar (com validade opcional), copiar e revogar. O link completo só se vê logo a seguir a
 * criá-lo (o servidor só guarda o hash do token): fechar o diálogo esquece-o, e os links ativos aparecem sem endereço.
 */
export function ShareDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const shares = useShares(file.id);
  const create = useCreateShare(file.id);
  const revoke = useRevokeShare(file.id);
  const [validity, setValidity] = useState("");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const linkField = useRef<HTMLInputElement>(null);

  // Depois de criar o link o foco vai para o campo (que se seleciona ao receber o foco): quem usa o teclado ou um leitor de ecrã
  // fica no endereço, que só se vê uma vez, e Ctrl+C copia-o logo.
  useEffect(() => {
    if (created) linkField.current?.focus();
  }, [created]);

  function createLink() {
    const days = validity === "" ? null : Number(validity);
    setCopy(null);
    create.mutate(days === null ? null : Date.now() + days * DAY_MS, {
      onSuccess: ({ share, token }) => setCreated({ id: share.id, url: shareUrl(token), expiresAt: share.expiresAt }),
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // Sem permissão ou sem ligação segura: seleciona o texto para o utilizador o copiar com o teclado.
      linkField.current?.focus();
      linkField.current?.select();
      setCopy("failed");
    }
  }

  return (
    <Modal title={`Partilhar «${file.name}»`} onClose={() => !create.isPending && onClose()}>
      <div className="space-y-5">
        <p className="text-sm text-slate-700">Qualquer pessoa com o link pode descarregar este ficheiro, sem iniciar sessão.</p>

        <section aria-label="Novo link" className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Validade do link</span>
            <select
              value={validity}
              onChange={(event) => setValidity(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              {VALIDITIES.map((option) => (
                <option key={option.label} value={option.days ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {create.error && <Message kind="error">{errorMessage(create.error)}</Message>}
          <Button disabled={create.isPending} onClick={createLink}>
            {create.isPending ? "A criar…" : "Criar link"}
          </Button>
        </section>

        {created && (
          <section aria-label="Link criado" className="space-y-2 rounded-lg bg-indigo-50 p-3">
            <p className="text-sm text-slate-700">
              Link criado ({validityText(created.expiresAt)}). Copie-o agora: por segurança, não voltará a ser mostrado.
            </p>
            <div className="flex gap-2">
              <input
                ref={linkField}
                readOnly
                aria-label="Link de partilha"
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <Button variant="secondary" onClick={() => void copyLink(created.url)}>
                Copiar
              </Button>
            </div>
            {copy === "copied" && <Message kind="success">Link copiado.</Message>}
            {copy === "failed" && (
              <Message kind="error">Não foi possível copiar sozinho: o link está selecionado, copie-o com Ctrl+C (⌘C no Mac).</Message>
            )}
          </section>
        )}

        <section aria-label="Links ativos" className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Links ativos</h3>
          {revoke.error && <Message kind="error">{errorMessage(revoke.error)}</Message>}
          {shares.isPending ? (
            <Loading className="text-sm" />
          ) : shares.isError && shares.data === undefined ? (
            <div className="space-y-2">
              <Message kind="error">{errorMessage(shares.error)}</Message>
              <Button variant="secondary" onClick={() => void shares.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : shares.data.length === 0 ? (
            <p className="text-sm text-slate-500">Ainda não há links ativos.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {shares.data.map((share, index) => (
                <li key={share.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 text-slate-700">
                    Link {index + 1}: criado a {formatDate(share.createdAt)}, {validityText(share.expiresAt)}
                  </span>
                  <Button
                    variant="secondary"
                    className="shrink-0 px-3 py-1.5"
                    disabled={revoke.isPending}
                    aria-label={`Revogar o link ${index + 1}, criado a ${formatDate(share.createdAt)}`}
                    onClick={() =>
                      revoke.mutate(share.id, {
                        onSuccess: () => setCreated((current) => (current?.id === share.id ? null : current)),
                      })
                    }
                  >
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">Revogar um link faz com que deixe de funcionar logo.</p>
        </section>

        <div className="flex justify-end">
          <Button variant="secondary" disabled={create.isPending} onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
