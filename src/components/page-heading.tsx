export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.18em] text-orange-600">{eyebrow}</p><h1 className="font-heading text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">{title}</h1><p className="mt-1.5 max-w-2xl text-sm text-slate-500">{description}</p></div>{action}</div>;
}
