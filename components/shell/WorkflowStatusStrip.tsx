export const WorkflowStatusStrip = ({ stageLabel, blocker, nextAction }: { stageLabel: string; blocker: string; nextAction: string }) => (
  <div className="workflow-status-strip" data-testid="workflow-status-strip">
    <span><strong>Now</strong> {stageLabel}</span>
    <span><strong>Fix</strong> {blocker}</span>
    <span><strong>Next</strong> {nextAction}</span>
  </div>
);
