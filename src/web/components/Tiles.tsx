import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
import type { FileItem, FolderItem } from "../../shared/types";
import { extensionLabel, showsThumbnail } from "../thumbnails";
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";

// Sem `overflow-hidden` no quadrado: o menu «⋮» abre-se por cima do que está à volta e seria cortado. O corte é só no rosto.
const TILE = "relative flex flex-col rounded-xl border border-slate-200 bg-white hover:border-indigo-300";
const FACE = "flex aspect-square w-full items-center justify-center overflow-hidden rounded-t-xl bg-slate-50";
// O anel de foco só nos rostos que são botões ou ligações (um rosto sem ação não recebe o foco).
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300";

function Caption({ name, detail, actions }: { name: string; detail: string; actions: ReactNode }) {
  return (
    <div className="flex items-center gap-1 border-t border-slate-100 py-1 pr-1 pl-3">
      <span className="min-w-0 flex-1">
        <span title={name} className="block truncate text-sm font-medium text-slate-900">
          {name}
        </span>
        <span className="block truncate text-xs text-slate-500">{detail}</span>
      </span>
      <span className="shrink-0">{actions}</span>
    </div>
  );
}

/** Uma pasta no mosaico: o ícone, que é uma ligação para a pasta, o nome e o menu «⋮». */
export function FolderTile({ folder }: { folder: FolderItem }) {
  return (
    <li className={TILE}>
      <Link to={`/pasta/${folder.id}`} aria-label={`Abrir a pasta ${folder.name}`} className={`${FACE} ${FOCUS}`}>
        <FolderIcon large />
      </Link>
      <Caption name={folder.name} detail="Pasta" actions={<FolderActions folder={folder} />} />
    </li>
  );
}

/**
 * Um ficheiro no mosaico. As imagens pequenas mostram a própria imagem (carregada só quando o quadrado está perto do ecrã); os outros
 * ficheiros, o ícone e a extensão. Se o ficheiro se pré-visualiza (e quem usa o quadrado trata disso, `onPreview`), o quadrado é um botão
 * que a pede.
 */
export function FileTile({ file, onPreview }: { file: FileItem; onPreview?: (file: FileItem) => void }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const canPreview = onPreview !== undefined && previewContentType(file.name) !== null;
  const openPreview = () => onPreview?.(file);
  const extension = extensionLabel(file.name);

  const face =
    showsThumbnail(file) && !thumbnailFailed ? (
      // `alt` vazio: o nome do ficheiro já está por baixo. `draggable={false}`: arrastar a imagem para a página (a zona de largar) enviava uma
      // cópia, porque o Chromium põe a imagem no que se arrasta. `decoding` e `fetchPriority`: as miniaturas não atrasam o resto da página.
      <img
        src={`/api/files/${encodeURIComponent(file.id)}/preview`}
        alt=""
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        draggable={false}
        onError={() => setThumbnailFailed(true)}
        className="h-full w-full object-cover"
      />
    ) : (
      <span className="flex flex-col items-center gap-1">
        <FileIcon large />
        {extension && (
          <span aria-hidden="true" className="text-xs font-semibold text-slate-500">
            {extension}
          </span>
        )}
      </span>
    );

  return (
    <li className={TILE}>
      {canPreview ? (
        <button
          type="button"
          aria-label={`Pré-visualizar ${file.name}`}
          data-preview-id={file.id}
          onClick={openPreview}
          className={`${FACE} ${FOCUS}`}
        >
          {face}
        </button>
      ) : (
        <div className={FACE}>{face}</div>
      )}
      <Caption
        name={file.name}
        detail={formatBytes(file.size)}
        actions={<FileActions file={file} onPreview={canPreview ? openPreview : undefined} />}
      />
    </li>
  );
}
