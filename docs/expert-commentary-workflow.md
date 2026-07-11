# Expert Commentary Workflow

The RGI Newsletter Generator is moving from autonomous newsletter generation toward a human-in-the-loop expert commentary workflow:

`news ingestion -> daily article shortlist -> professor matching -> professor questionnaire -> grounded RGI article`

## Professor Library

The first foundation is the Professor Library. It stores structured professor expertise profiles in the `professor_profiles` Firestore collection so future milestones can match shortlisted articles to relevant faculty expertise.

Professor profiles intentionally exclude private contact fields. Email delivery, professor authentication, matching, questionnaires, and grounded article generation are deferred.

## Write Safety

Professor Library reads are available through the API. Create and update routes are disabled by default because administrator authentication is not implemented yet.

Server writes require the non-secret flag:

```bash
PROFESSOR_LIBRARY_WRITES_ENABLED=true
```

The flag is disabled when missing, empty, or set to any value other than the exact string `true`. Keep it unset or explicitly set it to `false` in local environment configuration.

Do not enable this flag for production-like environments until an authenticated administrator workflow exists.

## Deferred Milestones

- Article-to-professor matching
- Semantic embeddings or matching prompts
- Daily shortlist workflow changes
- Professor questionnaires and response links
- Email invitations
- Grounded article generation
- Attribution approval and editorial audit logs
- Firestore rules or deployment changes
