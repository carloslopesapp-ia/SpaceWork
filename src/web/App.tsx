import { Navigate, Route, Routes, useParams } from "react-router";
import AppLayout from "./components/AppLayout";
import AccountPage from "./pages/AccountPage";
import FolderPage from "./pages/FolderPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
import SharePage from "./pages/SharePage";
import TrashPage from "./pages/TrashPage";

/**
 * A raiz e `/pasta/:folderId` partilham o mesmo `FolderPage` na árvore do React, que por isso manteria o estado ao mudar
 * de pasta (o diálogo «Nova pasta» aberto, o aviso das pastas largadas, o erro da mutação): a `key` recomeça a página.
 */
function FolderRoute() {
  return <FolderPage key={useParams().folderId ?? "root"} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registo" element={<RegisterPage />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route element={<AppLayout />}>
        <Route index element={<FolderRoute />} />
        <Route path="pasta/:folderId" element={<FolderRoute />} />
        <Route path="pesquisa" element={<SearchPage />} />
        <Route path="lixeira" element={<TrashPage />} />
        <Route path="conta" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
