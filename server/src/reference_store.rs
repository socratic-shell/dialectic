use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Global reference store instance
static GLOBAL_REFERENCE_STORE: std::sync::OnceLock<ReferenceStore> = std::sync::OnceLock::new();

/// Get the global reference store instance
pub fn global_reference_store() -> &'static ReferenceStore {
    GLOBAL_REFERENCE_STORE.get_or_init(|| ReferenceStore::new())
}

/// Context data that can be referenced by a compact ssref
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceContext {
    /// File path relative to workspace
    pub file: Option<String>,
    /// Line number (1-based)
    pub line: Option<u32>,
    /// Selected text content
    pub selection: Option<String>,
    /// User comment or question
    pub user_comment: Option<String>,
    /// Additional context data
    pub metadata: HashMap<String, String>,
}

/// A stored reference with expiration
#[derive(Debug, Clone)]
struct StoredReference {
    context: ReferenceContext,
    created_at: Instant,
    expires_at: Instant,
}

/// In-memory reference storage with automatic expiration
#[derive(Debug, Clone)]
pub struct ReferenceStore {
    references: Arc<RwLock<HashMap<String, StoredReference>>>,
    default_ttl: Duration,
}

impl ReferenceStore {
    /// Create a new reference store with default TTL of 1 hour
    pub fn new() -> Self {
        Self {
            references: Arc::new(RwLock::new(HashMap::new())),
            default_ttl: Duration::from_secs(3600), // 1 hour
        }
    }

    /// Create a new reference store with custom TTL
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            references: Arc::new(RwLock::new(HashMap::new())),
            default_ttl: ttl,
        }
    }

    /// Store a reference context and return a unique ID
    pub async fn store(&self, context: ReferenceContext) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.store_with_id(&id, context).await?;
        Ok(id)
    }

    /// Store a reference context with a specific ID
    pub async fn store_with_id(&self, id: &str, context: ReferenceContext) -> Result<()> {
        let now = Instant::now();
        
        let stored_ref = StoredReference {
            context,
            created_at: now,
            expires_at: now + self.default_ttl,
        };

        let mut refs = self.references.write().await;
        refs.insert(id.to_string(), stored_ref);
        
        // Clean up expired references while we have the write lock
        self.cleanup_expired(&mut refs);
        
        Ok(())
    }

    /// Retrieve a reference context by ID
    pub async fn get(&self, id: &str) -> Result<Option<ReferenceContext>> {
        let mut refs = self.references.write().await;
        
        // Clean up expired references
        self.cleanup_expired(&mut refs);
        
        // Check if reference exists and is not expired
        if let Some(stored_ref) = refs.get(id) {
            if Instant::now() < stored_ref.expires_at {
                Ok(Some(stored_ref.context.clone()))
            } else {
                // Reference expired, remove it
                refs.remove(id);
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    /// Remove expired references from the store
    fn cleanup_expired(&self, refs: &mut HashMap<String, StoredReference>) {
        let now = Instant::now();
        refs.retain(|_, stored_ref| now < stored_ref.expires_at);
    }

    /// Get statistics about the reference store
    pub async fn stats(&self) -> (usize, usize) {
        let mut refs = self.references.write().await;
        let total_before = refs.len();
        
        self.cleanup_expired(&mut refs);
        let active_after = refs.len();
        
        (active_after, total_before - active_after)
    }
}

impl Default for ReferenceStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_store_and_retrieve() {
        let store = ReferenceStore::new();
        
        let context = ReferenceContext {
            file: Some("src/main.rs".to_string()),
            line: Some(42),
            selection: Some("let x = foo();".to_string()),
            user_comment: None,
            metadata: HashMap::new(),
        };

        let id = store.store(context.clone()).await.unwrap();
        let retrieved = store.get(&id).await.unwrap().unwrap();
        
        assert_eq!(retrieved.file, context.file);
        assert_eq!(retrieved.line, context.line);
        assert_eq!(retrieved.selection, context.selection);
    }

    #[tokio::test]
    async fn test_expiration() {
        let store = ReferenceStore::with_ttl(Duration::from_millis(100));
        
        let context = ReferenceContext {
            file: Some("test.rs".to_string()),
            line: None,
            selection: None,
            user_comment: Some("Test comment".to_string()),
            metadata: HashMap::new(),
        };

        let id = store.store(context).await.unwrap();
        
        // Should exist immediately
        assert!(store.get(&id).await.unwrap().is_some());
        
        // Wait for expiration
        sleep(Duration::from_millis(150)).await;
        
        // Should be expired
        assert!(store.get(&id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_stats() {
        let store = ReferenceStore::with_ttl(Duration::from_millis(100));
        
        let context = ReferenceContext {
            file: Some("test.rs".to_string()),
            line: None,
            selection: None,
            user_comment: None,
            metadata: HashMap::new(),
        };

        // Store multiple references
        store.store(context.clone()).await.unwrap();
        store.store(context.clone()).await.unwrap();
        
        let (active, _expired) = store.stats().await;
        assert_eq!(active, 2);
        
        // Wait for expiration
        sleep(Duration::from_millis(150)).await;
        
        let (active, expired) = store.stats().await;
        assert_eq!(active, 0);
        assert_eq!(expired, 2);
    }
}
