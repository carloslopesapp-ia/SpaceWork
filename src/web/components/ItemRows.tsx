import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatBytes, formatDate } from "../../shared/format";
import { previewContentType } from "../../shared/preview";
import type { FileItem, FolderItem } from "../../shared/types";
import { FileActions } from "./FileActions";
import { FolderActions } from "./FolderActions";
import { FileIcon, FolderIcon } from "./icons";
import { PreviewDialog } from "./PreviewDialog";

interface ItemRowProps {
  icon: ReactNode;
  name: ReactNode;
  size: string;
  date: string;
  /** O menu de ações da linha. */
  actions?: ReactNode;
}

function ItemRow({ icon, name, size, date, actions }: ItemRowProps) {
  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
      {icon}
      <span className="min-w-0 flex-1">{name}</span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{size}</span>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 sm:block">{date}</span>
      <span className="w-9 shrink-0">{actions}</span>
    </li>
  );
}

export function FolderRow({ folder }: { folder: FolderItem }) {
  return (
    <ItemRow
      icon={<FolderIcon />}
      name={
        <Link to={`/pasta/${folder.id}`} title={folder.name} className="block truncate font-medium hover:underline">
          {folder.name}
        </Link>
      }
      size="—"
      date={formatDate(folder.createdAt)}
      actions={<FolderActions folder={folder} />}
    />
  );
}

export function FileRow({ file }: { file: FileItem }) {
  const [previewing, setPreviewing] = useState(false);
  const canPreview = previewContentType(file.name) !== null;
  const openPreview = () => setPreviewing(true);
  return (
    <ItemRow
      icon={<FileIcon />}
      name={
        canPreview ? (
          <button type="button" title={file.name} onClick={openPreview} className="block w-full truncate text-left hover:underline">
            {file.name}
          </button>
        ) : (
          <span title={file.name} className="block truncate">
            {file.name}
          </span>
        )
      }
      size={formatBytes(file.size)}
      date={formatDate(file.createdAt)}
      actions={
        <>
          <FileActions file={file} onPreview={canPreview ? openPreview : undefined} />
          {previewing && <PreviewDialog file={file} onClose={() => setPreviewing(false)} />}
        </>
      }
    />
  );
}
