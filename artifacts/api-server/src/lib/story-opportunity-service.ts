import type { Article } from "@workspace/db";
import type { ProfessorProfile } from "@workspace/api-zod";
import { listProfessorProfiles } from "./professor-profiles";
import {
  assertExpectedRevision,
  buildFrozenOpportunityWindow,
  calculateOpportunityWindowBounds,
  clearProfessorSelection,
  closeOpportunity,
  OpportunityCommandError,
  reopenOpportunity,
  selectProfessorForOpportunity,
  updateOpportunityAngle,
  type StoryOpportunity,
  type StoryOpportunityWindow,
} from "./story-opportunities";
import {
  FirestoreStoryOpportunityRepository,
  listOpportunityCandidateArticles,
  type FrozenSnapshotResult,
  type StoryOpportunityRepository,
} from "./story-opportunity-repository";

export type StoryOpportunityServiceDependencies = {
  repository: StoryOpportunityRepository;
  loadArticles: (windowStart: Date, windowEnd: Date) => Promise<Article[]>;
  loadProfessorProfiles: () => Promise<ProfessorProfile[]>;
  now: () => Date;
};

export class StoryOpportunityService {
  constructor(
    private readonly dependencies: StoryOpportunityServiceDependencies,
  ) {}

  async calculateWindow(
    asOf: Date,
    snapshotRevision = 1,
  ): Promise<FrozenSnapshotResult> {
    const bounds = calculateOpportunityWindowBounds(asOf);
    const [articles, professorProfiles] = await Promise.all([
      this.dependencies.loadArticles(bounds.windowStart, bounds.windowEnd),
      this.dependencies.loadProfessorProfiles(),
    ]);
    const snapshot = buildFrozenOpportunityWindow({
      articles,
      professorProfiles,
      asOf,
      calculatedAt: this.dependencies.now(),
      snapshotRevision,
    });
    return this.dependencies.repository.createFrozenSnapshot(
      snapshot.window,
      snapshot.opportunities,
    );
  }

  listWindows(): Promise<StoryOpportunityWindow[]> {
    return this.dependencies.repository.listWindows();
  }

  async getCurrentWindow(): Promise<{
    window: StoryOpportunityWindow | null;
    opportunities: StoryOpportunity[];
  }> {
    const window = await this.dependencies.repository.getLatestWindow();
    return {
      window,
      opportunities: window
        ? await this.dependencies.repository.listOpportunities(window.id)
        : [],
    };
  }

  async getWindowWithOpportunities(
    windowId: string,
  ): Promise<{
    window: StoryOpportunityWindow | null;
    opportunities: StoryOpportunity[];
  }> {
    const window = await this.dependencies.repository.getWindow(windowId);
    return {
      window,
      opportunities: window
        ? await this.dependencies.repository.listOpportunities(windowId)
        : [],
    };
  }

  getOpportunity(id: string): Promise<StoryOpportunity | null> {
    return this.dependencies.repository.getOpportunity(id);
  }

  async selectProfessor(input: {
    id: string;
    professorId: string;
    reason?: string | null;
    expectedRevision: number;
    actorId: string;
  }): Promise<StoryOpportunity | null> {
    const currentProfiles = await this.dependencies.loadProfessorProfiles();
    const currentProfile = currentProfiles.find(
      (profile) => profile.id === input.professorId,
    );
    return this.dependencies.repository.mutateOpportunity(
      input.id,
      (opportunity) => {
        const reason = input.reason?.trim() || null;
        if (
          opportunity.selectedProfessor?.professorId === input.professorId &&
          opportunity.selectedProfessor.reason === reason
        )
          return opportunity;
        assertExpectedRevision(opportunity, input.expectedRevision);
        const frozenMatch = opportunity.professorMatches.find(
          (match) => match.professorId === input.professorId,
        );
        if (!currentProfile) {
          throw new OpportunityCommandError(
            "PROFESSOR_PROFILE_UNAVAILABLE",
            "The Professor Profile is no longer available. Recalculate an explicit snapshot revision before selecting.",
            409,
          );
        }
        if (currentProfile.status !== "active") {
          throw new OpportunityCommandError(
            "PROFESSOR_PROFILE_INACTIVE",
            "The Professor Profile is currently inactive and cannot be selected.",
            409,
          );
        }
        if (
          frozenMatch &&
          currentProfile.profileRevision !== frozenMatch.profileRevision
        ) {
          throw new OpportunityCommandError(
            "PROFESSOR_PROFILE_REVISION_CHANGED",
            `Professor Profile revision ${frozenMatch.profileRevision} is stale; current revision is ${currentProfile.profileRevision}. Recalculate an explicit snapshot revision before selecting.`,
            409,
          );
        }
        return selectProfessorForOpportunity({
          opportunity,
          professorId: input.professorId,
          reason,
          actorId: input.actorId,
          occurredAt: this.dependencies.now().toISOString(),
        });
      },
    );
  }

  clearProfessor(input: {
    id: string;
    reason?: string | null;
    expectedRevision: number;
    actorId: string;
  }): Promise<StoryOpportunity | null> {
    return this.dependencies.repository.mutateOpportunity(
      input.id,
      (opportunity) => {
        if (!opportunity.selectedProfessor) return opportunity;
        assertExpectedRevision(opportunity, input.expectedRevision);
        return clearProfessorSelection({
          opportunity,
          reason: input.reason,
          actorId: input.actorId,
          occurredAt: this.dependencies.now().toISOString(),
        });
      },
    );
  }

  updateAngle(input: {
    id: string;
    angle: string;
    expectedRevision: number;
  }): Promise<StoryOpportunity | null> {
    return this.dependencies.repository.mutateOpportunity(
      input.id,
      (opportunity) => {
        const normalized = input.angle.trim().replace(/\s+/g, " ");
        if (opportunity.recommendedAngle === normalized) return opportunity;
        assertExpectedRevision(opportunity, input.expectedRevision);
        return updateOpportunityAngle(
          opportunity,
          input.angle,
          this.dependencies.now().toISOString(),
        );
      },
    );
  }

  close(input: {
    id: string;
    expectedRevision: number;
  }): Promise<StoryOpportunity | null> {
    return this.dependencies.repository.mutateOpportunity(
      input.id,
      (opportunity) => {
        if (opportunity.workflowState === "closed") return opportunity;
        assertExpectedRevision(opportunity, input.expectedRevision);
        return closeOpportunity(
          opportunity,
          this.dependencies.now().toISOString(),
        );
      },
    );
  }

  reopen(input: {
    id: string;
    expectedRevision: number;
  }): Promise<StoryOpportunity | null> {
    return this.dependencies.repository.mutateOpportunity(
      input.id,
      (opportunity) => {
        if (opportunity.workflowState !== "closed") return opportunity;
        assertExpectedRevision(opportunity, input.expectedRevision);
        return reopenOpportunity(
          opportunity,
          this.dependencies.now().toISOString(),
        );
      },
    );
  }
}

export const defaultStoryOpportunityService = new StoryOpportunityService({
  repository: new FirestoreStoryOpportunityRepository(),
  loadArticles: listOpportunityCandidateArticles,
  loadProfessorProfiles: () => listProfessorProfiles(),
  now: () => new Date(),
});
