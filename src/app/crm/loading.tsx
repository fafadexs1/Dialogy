export default function CrmLoading() {
  return <RouteLoading label="Carregando CRM" />;
}

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" />
        {label}
      </div>
    </div>
  );
}
