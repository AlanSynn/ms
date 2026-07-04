import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import { useMotionSmithAppController } from "./hooks/useMotionSmithAppController";

const App = () => {
  const workspaceProps = useMotionSmithAppController();

  return <AppWorkspaceShell {...workspaceProps} />;
};

export default App;
