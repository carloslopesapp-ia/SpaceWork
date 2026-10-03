import { Navigate, Route, Routes } from "react-router";
import AppLayout from "./components/AppLayout";
import AccountPage from "./pages/AccountPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registo" element={<RegisterPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="conta" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
