import { useEffect, useMemo, useState } from "react";
import {
  type CreateProfessorProfileBody,
  type ProfessorProfile,
  type UpdateProfessorProfileBody,
  getListProfessorProfilesQueryKey,
  useGetProfessorLibraryConfig,
  useCreateProfessorProfile,
  useListProfessorProfiles,
  useUpdateProfessorProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, GraduationCap, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { userSafeErrorMessage } from "@/lib/api-error";
import { asArray } from "@/lib/arrays";

type ProfileStatus = "active" | "paused" | "inactive";
type ParticipationStatus = "available" | "limited" | "unavailable";

type ProfessorFormState = {
  fullName: string;
  academicTitle: string;
  department: string;
  coursesTaught: string;
  expertiseTags: string;
  researchInterests: string;
  industries: string;
  regions: string;
  professionalBackground: string;
  approvedBio: string;
  publications: string;
  recurringThemes: string;
  contactableTopics: string;
  doNotContactTopics: string;
  participationStatus: ParticipationStatus;
  maxOpenRequests: string;
  status: ProfileStatus;
};

const EMPTY_FORM: ProfessorFormState = {
  fullName: "",
  academicTitle: "",
  department: "",
  coursesTaught: "",
  expertiseTags: "",
  researchInterests: "",
  industries: "",
  regions: "",
  professionalBackground: "",
  approvedBio: "",
  publications: "",
  recurringThemes: "",
  contactableTopics: "",
  doNotContactTopics: "",
  participationStatus: "available",
  maxOpenRequests: "3",
  status: "active",
};

function join(values: string[] | undefined): string {
  return asArray<string>(values).join(", ");
}

function split(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formFromProfile(profile?: ProfessorProfile): ProfessorFormState {
  if (!profile) return EMPTY_FORM;
  return {
    fullName: profile.fullName,
    academicTitle: profile.academicTitle,
    department: profile.department,
    coursesTaught: join(profile.coursesTaught),
    expertiseTags: join(profile.expertiseTags),
    researchInterests: join(profile.researchInterests),
    industries: join(profile.industries),
    regions: join(profile.regions),
    professionalBackground: profile.professionalBackground,
    approvedBio: profile.approvedBio,
    publications: join(profile.publications),
    recurringThemes: join(profile.recurringThemes),
    contactableTopics: join(profile.contactableTopics),
    doNotContactTopics: join(profile.doNotContactTopics),
    participationStatus: profile.participationStatus,
    maxOpenRequests: String(profile.maxOpenRequests),
    status: profile.status,
  };
}

function payloadFromForm(form: ProfessorFormState): CreateProfessorProfileBody {
  return {
    fullName: form.fullName,
    academicTitle: form.academicTitle,
    department: form.department,
    coursesTaught: split(form.coursesTaught),
    expertiseTags: split(form.expertiseTags),
    researchInterests: split(form.researchInterests),
    industries: split(form.industries),
    regions: split(form.regions),
    professionalBackground: form.professionalBackground,
    approvedBio: form.approvedBio,
    publications: split(form.publications),
    recurringThemes: split(form.recurringThemes),
    contactableTopics: split(form.contactableTopics),
    doNotContactTopics: split(form.doNotContactTopics),
    participationStatus: form.participationStatus,
    maxOpenRequests: Number(form.maxOpenRequests),
    status: form.status,
  };
}

function statusBadgeClass(status: ProfileStatus): string {
  if (status === "active") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "paused") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function participationLabel(status: ParticipationStatus): string {
  if (status === "available") return "Available";
  if (status === "limited") return "Limited";
  return "Unavailable";
}

function tagPreview(values: string[]): string {
  if (values.length === 0) return "No tags yet";
  return values.slice(0, 3).join(", ") + (values.length > 3 ? ` +${values.length - 3}` : "");
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;
}

function ProfessorForm({
  profile,
  writesEnabled,
  onCancel,
  onSaved,
}: {
  profile?: ProfessorProfile;
  writesEnabled: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProfessorFormState>(() => formFromProfile(profile));
  const [attempted, setAttempted] = useState(false);
  const queryClient = useQueryClient();
  const createProfile = useCreateProfessorProfile();
  const updateProfile = useUpdateProfessorProfile();
  const { toast } = useToast();
  const baseline = useMemo(() => JSON.stringify(formFromProfile(profile)), [profile]);
  const dirty = JSON.stringify(form) !== baseline;
  const saving = createProfile.isPending || updateProfile.isPending;
  const errors = {
    fullName: form.fullName.trim() ? undefined : "Full name is required.",
    academicTitle: form.academicTitle.trim() ? undefined : "Academic title is required.",
    department: form.department.trim() ? undefined : "Department is required.",
    maxOpenRequests: Number.isInteger(Number(form.maxOpenRequests)) && Number(form.maxOpenRequests) >= 0 && Number(form.maxOpenRequests) <= 20
      ? undefined
      : "Use a whole number from 0 to 20.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const updateField = <K extends keyof ProfessorFormState>(key: K, value: ProfessorFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleCancel = () => {
    if (dirty && !confirm("Discard unsaved professor profile changes?")) return;
    onCancel();
  };

  const handleSubmit = () => {
    setAttempted(true);
    if (!writesEnabled || hasErrors) return;
    const data = payloadFromForm(form);
    const onSuccess = async () => {
      await queryClient.invalidateQueries({ queryKey: getListProfessorProfilesQueryKey() });
      toast({ title: profile ? "Professor profile updated" : "Professor profile created" });
      onSaved();
    };
    const onError = (error: unknown) => {
      toast({
        title: "Save failed",
        description: userSafeErrorMessage(error, "Professor profile could not be saved."),
        variant: "destructive",
      });
    };

    if (profile) {
      updateProfile.mutate({ id: profile.id, data: data as UpdateProfessorProfileBody }, { onSuccess, onError });
    } else {
      createProfile.mutate({ data }, { onSuccess, onError });
    }
  };

  return (
    <Card className="border-border">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{profile ? "Edit Professor Profile" : "Add Professor Profile"}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Profile details are used for editorial coordination, not public contact disclosure.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCancel} aria-label="Close professor form">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!writesEnabled ? (
          <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Editing is disabled in this environment. Saves are blocked until administrator authentication is implemented and the server write flag is explicitly enabled.</span>
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          <div>
            <Label htmlFor="professor-full-name">Full name</Label>
            <Input id="professor-full-name" value={form.fullName} onChange={(event) => updateField("fullName", event.target.value)} disabled={!writesEnabled || saving} />
            {attempted ? <FieldError message={errors.fullName} /> : null}
          </div>
          <div>
            <Label htmlFor="professor-title">Academic title</Label>
            <Input id="professor-title" value={form.academicTitle} onChange={(event) => updateField("academicTitle", event.target.value)} disabled={!writesEnabled || saving} />
            {attempted ? <FieldError message={errors.academicTitle} /> : null}
          </div>
          <div>
            <Label htmlFor="professor-department">Department</Label>
            <Input id="professor-department" value={form.department} onChange={(event) => updateField("department", event.target.value)} disabled={!writesEnabled || saving} />
            {attempted ? <FieldError message={errors.department} /> : null}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Participation</Label>
            <Select value={form.participationStatus} onValueChange={(value) => updateField("participationStatus", value as ParticipationStatus)} disabled={!writesEnabled || saving}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="limited">Limited</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(value) => updateField("status", value as ProfileStatus)} disabled={!writesEnabled || saving}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="professor-max-requests">Max open requests</Label>
            <Input id="professor-max-requests" type="number" min={0} max={20} value={form.maxOpenRequests} onChange={(event) => updateField("maxOpenRequests", event.target.value)} disabled={!writesEnabled || saving} />
            {attempted ? <FieldError message={errors.maxOpenRequests} /> : null}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          {[
            ["expertiseTags", "Expertise tags", "strategy, governance, global trade"],
            ["coursesTaught", "Courses taught", "Course names separated by commas"],
            ["researchInterests", "Research interests", "Research areas separated by commas"],
            ["industries", "Industries", "Industries separated by commas"],
            ["regions", "Regions", "Regions separated by commas"],
            ["recurringThemes", "Recurring themes", "Themes separated by commas"],
            ["contactableTopics", "Contactable topics", "Topics this professor can address"],
            ["doNotContactTopics", "Do-not-contact topics", "Topics to avoid"],
            ["publications", "Publications", "Publication titles or citations"],
          ].map(([key, label, placeholder]) => (
            <div key={key}>
              <Label htmlFor={`professor-${key}`}>{label}</Label>
              <Textarea
                id={`professor-${key}`}
                value={form[key as keyof ProfessorFormState]}
                onChange={(event) => updateField(key as keyof ProfessorFormState, event.target.value as never)}
                placeholder={placeholder}
                disabled={!writesEnabled || saving}
                className="min-h-20"
              />
            </div>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="professor-background">Professional background</Label>
            <Textarea id="professor-background" value={form.professionalBackground} onChange={(event) => updateField("professionalBackground", event.target.value)} disabled={!writesEnabled || saving} className="min-h-28" />
          </div>
          <div>
            <Label htmlFor="professor-bio">Approved bio</Label>
            <Textarea id="professor-bio" value={form.approvedBio} onChange={(event) => updateField("approvedBio", event.target.value)} disabled={!writesEnabled || saving} className="min-h-28" />
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!writesEnabled || saving} data-testid="btn-save-professor">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Save Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Professors() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ProfileStatus>("all");
  const [editing, setEditing] = useState<ProfessorProfile | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, refetch } = useListProfessorProfiles(status === "all" ? undefined : { status });
  const config = useGetProfessorLibraryConfig();
  const profiles = asArray<ProfessorProfile>(data?.items);
  const writesEnabled = config.data?.writesEnabled === true;
  const filtered = profiles.filter((profile) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      profile.fullName,
      profile.academicTitle,
      profile.department,
      ...profile.expertiseTags,
      ...profile.researchInterests,
      ...profile.industries,
      ...profile.regions,
    ].join(" ").toLowerCase().includes(q);
  });
  const activeCount = profiles.filter((profile) => profile.status === "active").length;
  const limitedCount = profiles.filter((profile) => profile.participationStatus === "limited").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Professor Library</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage faculty expertise and participation preferences for article matching and expert commentary.
          </p>
        </div>
        <Button onClick={() => { setAdding(true); setEditing(null); }} disabled={!writesEnabled} data-testid="btn-add-professor">
          <Plus className="mr-2 h-4 w-4" />
          Add Professor
        </Button>
      </div>

      {!writesEnabled ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Professor profiles are currently read-only. Administrator editing has not been enabled yet.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Profiles</p><p className="mt-1 text-2xl font-semibold">{profiles.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active</p><p className="mt-1 text-2xl font-semibold">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Limited availability</p><p className="mt-1 text-2xl font-semibold">{limitedCount}</p></CardContent></Card>
      </div>

      {(adding || editing) ? (
        <ProfessorForm
          profile={editing ?? undefined}
          writesEnabled={writesEnabled}
          onCancel={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); }}
        />
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, departments, expertise, industries, regions" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as "all" | ProfileStatus)}>
          <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading || config.isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-24 w-full" />)}
        </div>
      ) : isError || config.isError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 py-12 text-center">
          <p className="font-medium text-destructive">Professor profiles failed to load</p>
          <p className="mt-1 text-sm text-muted-foreground">Retry after the database is available.</p>
          <Button variant="ghost" className="mt-3" onClick={() => { void refetch(); void config.refetch(); }}>Try again</Button>
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white py-16 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 font-medium">No professor profiles yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            No professor profiles have been added yet. Profiles can be created once administrator editing is enabled.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-white py-12 text-center text-sm text-muted-foreground">
          No professor profiles match the current search or status filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-foreground">{profile.fullName}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(profile.status)}`}>
                        {profile.status}
                      </span>
                      <Badge variant="outline">{participationLabel(profile.participationStatus)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{profile.academicTitle} · {profile.department}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Expertise: <span className="text-foreground">{tagPreview(profile.expertiseTags)}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Contactable topics: <span className="text-foreground">{tagPreview(profile.contactableTopics)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Max open requests: {profile.maxOpenRequests}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(profile); setAdding(false); }} disabled={!writesEnabled}>
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
