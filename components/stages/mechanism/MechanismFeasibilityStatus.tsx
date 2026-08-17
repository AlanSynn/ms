import type { FabricationFeasibilityStatus } from "../../../utils/fabrication";
import { feasibilityLabelForStatus } from "../../../utils/fabrication";

export const MechanismFeasibilityStatus = ({
  status,
  testId,
}: {
  status: FabricationFeasibilityStatus;
  testId: string;
}) => (
  <div
    className="mechanism-feasibility-status"
    data-testid={testId}
    data-status={status}
    role="status"
  >
    <span>Motion</span>
    <strong>{feasibilityLabelForStatus(status)}</strong>
  </div>
);
