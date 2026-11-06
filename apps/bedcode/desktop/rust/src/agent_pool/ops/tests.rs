use super::*;
use crate::agent_pool::model::{CliFacts, ProfileInput};
use crate::agent_pool::store::MemoryStore;

fn input(name: &str, cli: &str) -> ProfileInput {
    ProfileInput {
        name: name.into(),
        cli: cli.into(),
        model: Some("anthropic/claude-sonnet".into()),
        thinking_level: None,
        tags: vec!["frontend".into()],
        specialties: vec!["Vue".into()],
        description: "负责前端实现".into(),
        can_orchestrate: false,
        enabled: true,
    }
}

fn facts() -> CliFacts {
    CliFacts {
        installed: true,
        bridge_capable: true,
    }
}

#[test]
fn create_update_delete_round_trip() {
    let store = MemoryStore::new();
    let created = create(&store, &input("前端", "pi"), facts(), "2026-11-06T00:00:00Z")
        .expect("create");
    assert!(!created.id.is_empty());
    assert_eq!(created.created_at, "2026-11-06T00:00:00Z");
    assert_eq!(list(&store).unwrap().len(), 1);
    assert_eq!(get(&store, &created.id).unwrap().unwrap().name, "前端");

    let mut next = input("前端实现", "pi");
    next.model = None;
    next.enabled = false;
    let updated = update(
        &store,
        &created.id,
        &next,
        facts(),
        "2026-11-06T01:00:00Z",
    )
    .expect("update");
    assert_eq!(updated.name, "前端实现");
    assert_eq!(updated.model, None);
    assert!(!updated.enabled);
    assert_eq!(updated.created_at, created.created_at);
    assert_eq!(updated.updated_at, "2026-11-06T01:00:00Z");

    assert!(delete(&store, &created.id).unwrap());
    assert!(!delete(&store, &created.id).unwrap());
    assert!(get(&store, &created.id).unwrap().is_none());
}

#[test]
fn update_requires_an_existing_profile() {
    let store = MemoryStore::new();
    let err = update(&store, "missing", &input("a", "pi"), facts(), "t").unwrap_err();
    assert!(err.starts_with("profile-not-found:"));
}

#[test]
fn name_conflict_is_rejected_across_profiles() {
    let store = MemoryStore::new();
    create(&store, &input("Review", "pi"), facts(), "t").unwrap();
    let err = create(&store, &input("review", "opencode"), facts(), "t2").unwrap_err();
    assert!(err.starts_with("profile-name-taken:"));
}

#[test]
fn capacity_is_bounded() {
    let store = MemoryStore::new();
    for index in 0..crate::agent_pool::model::MAX_PROFILES {
        create(
            &store,
            &input(&format!("agent-{index}"), "pi"),
            facts(),
            "t",
        )
        .unwrap();
    }
    let err = create(&store, &input("overflow", "pi"), facts(), "t").unwrap_err();
    assert!(err.starts_with("profile-capacity:"));
}
