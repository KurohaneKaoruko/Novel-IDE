/**
 * Example usage of DiffView integration in App.tsx
 * 
 * This file demonstrates how to create and display a ChangeSet with DiffView
 */

import { modificationService, diffService } from '../services';
import { useDiff } from '../contexts/DiffContext';

/**
 * Example: Creating a ChangeSet from AI modifications
 * 
 * This would typically be called after receiving AI-generated modifications
 */
export function exampleCreateChangeSet() {
  // Example: AI suggests modifications to a file
  const originalContent = `Chapter 1: The Beginning

The sun rose over the mountains.
The hero woke up.
He prepared for his journey.`;

  const modifiedContent = `Chapter 1: The Epic Beginning

The golden sun rose majestically over the snow-capped mountains.
The hero woke up, feeling refreshed and determined.
He carefully prepared for his perilous journey ahead.`;

  // Calculate diff
  const diffResult = diffService.computeDiff(originalContent, modifiedContent);
  const modifications = diffService.diffToModifications(diffResult);

  // Create a ChangeSet
  const changeSet = modificationService.createChangeSet([
    {
      filePath: 'stories/chapter-001.txt',
      originalContent,
      modifications,
      status: 'pending',
    },
  ]);

  return changeSet;
}

/**
 * Example: Opening a DiffView from a component
 * 
 * This shows how to add a ChangeSet to the DiffContext and open the DiffView panel
 */
export function ExampleOpenDiffView() {
  const diffContext = useDiff();

  const handleOpenDiff = () => {
    // Create a change set (in real app, this would come from AI)
    const changeSet = exampleCreateChangeSet();

    // Add to DiffContext
    diffContext.addChangeSet(changeSet);

    // Set as active (this would trigger the DiffView panel to open in App.tsx)
    diffContext.setActiveChangeSet(changeSet.id);

    // In App.tsx, you would also need to:
    // setShowDiffPanel(true);
    // setActiveDiffTab(changeSet.id);
  };

  return (
    <button onClick={handleOpenDiff}>
      Open Diff View Example
    </button>
  );
}

/**
 * Example: Integrating with AI chat response
 * 
 * This shows how to handle AI responses that include file modifications
 */
export function exampleHandleAIResponse(aiResponse: {
  message: string;
  modifications?: Array<{
    filePath: string;
    originalContent: string;
    modifiedContent: string;
  }>;
}) {
  const diffContext = useDiff();

  // If AI response includes modifications
  if (aiResponse.modifications && aiResponse.modifications.length > 0) {
    const fileModifications = aiResponse.modifications.map((mod) => {
      const diffResult = diffService.computeDiff(mod.originalContent, mod.modifiedContent);
      const modifications = diffService.diffToModifications(diffResult);

      return {
        filePath: mod.filePath,
        originalContent: mod.originalContent,
        modifications,
        status: 'pending' as const,
      };
    });

    // Create ChangeSet
    const changeSet = modificationService.createChangeSet(fileModifications);

    // Add to context
    diffContext.addChangeSet(changeSet);

    // Return the changeSet ID so the caller can open the DiffView
    return changeSet.id;
  }

  return null;
}

/**
 * Example: Complete workflow in App.tsx
 * 
 * This shows the complete integration pattern:
 * 
 * 1. In your AI chat handler (onSendChat):
 * 
 * ```typescript
 * const onSendChat = useCallback(async (content: string) => {
 *   // ... existing chat logic ...
 *   
 *   // After receiving AI response with modifications:
 *   const changeSetId = exampleHandleAIResponse(aiResponse);
 *   
 *   if (changeSetId) {
 *     // Open the DiffView panel
 *     onOpenDiffView(changeSetId);
 *   }
 * }, [onOpenDiffView]);
 * ```
 * 
 * 2. The DiffView panel will automatically display with tabs for each ChangeSet
 * 
 * 3. Users can:
 *    - Switch between different ChangeSets using tabs
 *    - Accept/reject individual modifications
 *    - Accept/reject all modifications in a file
 *    - Toggle between split and unified view modes
 *    - Close individual ChangeSets or the entire panel
 * 
 * 4. When modifications are accepted:
 *    - Files are automatically updated via ModificationService
 *    - The file tree is refreshed
 *    - The ChangeSet status is updated
 */

export default {
  exampleCreateChangeSet,
  ExampleOpenDiffView,
  exampleHandleAIResponse,
};
