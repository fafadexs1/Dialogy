import { notFound } from 'next/navigation';

// Keep this route on disk: removing a page while another dev server is scanning
// Tailwind content can leave that server trying to stat a deleted file.
export default async function Page() {
  if (process.env.WORKFLOW_EDITOR_PREVIEW !== '1') notFound();

  const { default: Preview } = await import('../../../tests/fixtures/workflow-editor-preview');
  return <Preview />;
}
