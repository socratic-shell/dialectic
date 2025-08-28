use pulldown_cmark::{Event, Parser, html};
use quick_xml::events::Event as XmlEvent;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

use crate::dialect::{DialectInterpreter};
use crate::ide::IpcClient;

/// Parsed XML element from walkthrough markdown
#[derive(Debug, Clone, PartialEq)]
pub enum XmlElement {
    Comment {
        location: String,
        icon: Option<String>,
        content: String,
    },
    GitDiff {
        range: String,
        exclude_unstaged: bool,
        exclude_staged: bool,
    },
    Action {
        button: String,
        message: String,
    },
    Mermaid {
        content: String,
    },
}

/// Resolved XML element with dummy data for Phase 1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedXmlElement {
    pub element_type: String,
    pub attributes: HashMap<String, String>,
    pub resolved_data: serde_json::Value,
    pub content: String,
}

/// Main walkthrough parser
pub struct WalkthroughParser<T: IpcClient> {
    interpreter: DialectInterpreter<T>,
}

impl<T: IpcClient> WalkthroughParser<T> {
    pub fn new(interpreter: DialectInterpreter<T>) -> Self {
        Self { interpreter }
    }

    /// Parse markdown with embedded XML elements and return normalized output
    pub async fn parse_and_normalize(&mut self, content: &str) -> Result<String, Box<dyn std::error::Error>> {
        let processed_events = self.process_events_sequentially(content).await?;
        Self::render_events_to_markdown(processed_events)
    }

    /// Process pulldown-cmark event stream sequentially
    async fn process_events_sequentially<'a>(&mut self, content: &'a str) -> Result<Vec<Event<'a>>, Box<dyn std::error::Error>> {
        let mut input_events: VecDeque<Event<'a>> = Parser::new(content).collect();
        let mut output_events = Vec::new();
        
        while let Some(event) = input_events.pop_front() {
            // For now, just pass through all events unchanged
            output_events.push(event);
        }
        
        Ok(output_events)
    }

    /// Render pulldown-cmark events back to markdown/HTML
    fn render_events_to_markdown<'a>(events: Vec<Event<'a>>) -> Result<String, Box<dyn std::error::Error>> {
        let mut output = String::new();
        html::push_html(&mut output, events.into_iter());
        Ok(output)
    }

    /// Resolve a single XML element with Dialect evaluation
    async fn resolve_single_element(&mut self, element: XmlElement) -> Result<ResolvedXmlElement, Box<dyn std::error::Error>> {
        let (element_type, attributes, resolved_data) = match &element {
            XmlElement::Comment { location, icon, content: _ } => {
                let mut attrs = HashMap::new();
                if let Some(icon) = icon {
                    attrs.insert("icon".to_string(), icon.clone());
                }
                
                // Resolve Dialect expression for location
                let resolved_data = if !location.is_empty() {
                    match self.interpreter.evaluate(location).await {
                        Ok(result) => {
                            serde_json::json!({
                                "locations": result,
                                "dialect_expression": location
                            })
                        }
                        Err(e) => {
                            serde_json::json!({
                                "error": format!("Failed to resolve location: {}", e),
                                "dialect_expression": location
                            })
                        }
                    }
                } else {
                    serde_json::json!({
                        "locations": []
                    })
                };
                
                ("comment".to_string(), attrs, resolved_data)
            }
            XmlElement::GitDiff { range, exclude_unstaged, exclude_staged } => {
                let mut attrs = HashMap::new();
                if *exclude_unstaged {
                    attrs.insert("exclude-unstaged".to_string(), "true".to_string());
                }
                if *exclude_staged {
                    attrs.insert("exclude-staged".to_string(), "true".to_string());
                }
                
                let resolved_data = serde_json::json!({
                    "range": range,
                    "type": "gitdiff"
                });
                
                ("gitdiff".to_string(), attrs, resolved_data)
            }
            XmlElement::Action { button, message: _ } => {
                let mut attrs = HashMap::new();
                attrs.insert("button".to_string(), button.clone());
                
                let resolved_data = serde_json::json!({
                    "button_text": button
                });
                
                ("action".to_string(), attrs, resolved_data)
            }
            XmlElement::Mermaid { content: _ } => {
                let attrs = HashMap::new();
                let resolved_data = serde_json::json!({
                    "type": "mermaid",
                    "rendered": true
                });
                
                ("mermaid".to_string(), attrs, resolved_data)
            }
        };

        let content = match &element {
            XmlElement::Comment { content, .. } => content.clone(),
            XmlElement::Action { message, .. } => message.clone(),
            XmlElement::Mermaid { content } => content.clone(),
            XmlElement::GitDiff { .. } => String::new(),
        };

        Ok(ResolvedXmlElement {
            element_type,
            attributes,
            resolved_data,
            content,
        })
    }

    fn parse_xml_element(&self, xml_text: &str) -> Result<XmlElement, Box<dyn std::error::Error>> {
        let mut reader = Reader::from_str(xml_text);
        reader.config_mut().trim_text(true);
        
        let mut buf = Vec::new();
        let mut element_name = String::new();
        let mut attributes = HashMap::new();
        let mut content = String::new();
        
        loop {
            match reader.read_event_into(&mut buf)? {
                XmlEvent::Start(e) => {
                    element_name = String::from_utf8(e.name().as_ref().to_vec())?;
                    
                    // Parse attributes
                    for attr in e.attributes() {
                        let attr = attr?;
                        let key = String::from_utf8(attr.key.as_ref().to_vec())?;
                        let value = String::from_utf8(attr.value.to_vec())?;
                        attributes.insert(key, value);
                    }
                }
                XmlEvent::Text(e) => {
                    content = std::str::from_utf8(&e)?.to_string();
                }
                XmlEvent::End(_) => break,
                XmlEvent::Empty(e) => {
                    element_name = String::from_utf8(e.name().as_ref().to_vec())?;
                    
                    // Parse attributes for self-closing tags
                    for attr in e.attributes() {
                        let attr = attr?;
                        let key = String::from_utf8(attr.key.as_ref().to_vec())?;
                        let value = String::from_utf8(attr.value.to_vec())?;
                        attributes.insert(key, value);
                    }
                    break;
                }
                XmlEvent::Eof => break,
                _ => {}
            }
            buf.clear();
        }

        // Convert to appropriate XmlElement variant
        match element_name.as_str() {
            "comment" => Ok(XmlElement::Comment {
                location: attributes.get("location").unwrap_or(&String::new()).clone(),
                icon: attributes.get("icon").cloned(),
                content,
            }),
            "gitdiff" => Ok(XmlElement::GitDiff {
                range: attributes.get("range").unwrap_or(&String::new()).clone(),
                exclude_unstaged: attributes.contains_key("exclude-unstaged"),
                exclude_staged: attributes.contains_key("exclude-staged"),
            }),
            "action" => Ok(XmlElement::Action {
                button: attributes.get("button").unwrap_or(&String::new()).clone(),
                message: content,
            }),
            "mermaid" => Ok(XmlElement::Mermaid { content }),
            _ => Err(format!("Unknown XML element: {}", element_name).into()),
        }
    }

    /// Create normalized XML with resolved data
    fn create_normalized_xml(&self, resolved: &ResolvedXmlElement) -> String {
        let mut attrs = String::new();
        
        // Add resolved data
        let resolved_json = serde_json::to_string(&resolved.resolved_data).unwrap_or_default();
        attrs.push_str(&format!(" data-resolved='{}'", resolved_json));
        
        // Add original attributes
        for (key, value) in &resolved.attributes {
            attrs.push_str(&format!(" {}=\"{}\"", key, value));
        }

        if resolved.content.is_empty() {
            format!("<{}{} />", resolved.element_type, attrs)
        } else {
            format!(
                "<{}{}>{}</{}>",
                resolved.element_type, attrs, resolved.content, resolved.element_type
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ide::test::MockIpcClient;
    use crate::ide::{FindDefinitions, FindReferences};

    fn create_test_parser() -> WalkthroughParser<MockIpcClient> {
        let mut interpreter = DialectInterpreter::new(MockIpcClient::new());
        interpreter.add_function::<FindDefinitions>();
        interpreter.add_function::<FindReferences>();
        WalkthroughParser::new(interpreter)
    }

    #[test]
    fn test_parse_comment_element() {
        let parser = create_test_parser();
        let xml = r#"<comment location="findDefinitions(`User`)" icon="lightbulb">This is a comment</comment>"#;
        
        let element = parser.parse_xml_element(xml).unwrap();
        
        match element {
            XmlElement::Comment { location, icon, content } => {
                assert_eq!(location, "findDefinitions(`User`)");
                assert_eq!(icon, Some("lightbulb".to_string()));
                assert_eq!(content, "This is a comment");
            }
            _ => panic!("Expected Comment element"),
        }
    }

    #[test]
    fn test_parse_self_closing_gitdiff() {
        let parser = create_test_parser();
        let xml = r#"<gitdiff range="HEAD~2..HEAD" exclude-unstaged="true" />"#;
        
        let element = parser.parse_xml_element(xml).unwrap();
        
        match element {
            XmlElement::GitDiff { range, exclude_unstaged, exclude_staged } => {
                assert_eq!(range, "HEAD~2..HEAD");
                assert!(exclude_unstaged);
                assert!(!exclude_staged);
            }
            _ => panic!("Expected GitDiff element"),
        }
    }

    #[test]
    fn test_parse_action_element() {
        let parser = create_test_parser();
        let xml = r#"<action button="Test the changes">Run the test suite</action>"#;
        
        let element = parser.parse_xml_element(xml).unwrap();
        
        match element {
            XmlElement::Action { button, message } => {
                assert_eq!(button, "Test the changes");
                assert_eq!(message, "Run the test suite");
            }
            _ => panic!("Expected Action element"),
        }
    }

    #[test]
    fn test_parse_mermaid_element() {
        let parser = create_test_parser();
        let xml = r#"<mermaid>flowchart TD
    A[Start] --> B[End]</mermaid>"#;
        
        let element = parser.parse_xml_element(xml).unwrap();
        
        match element {
            XmlElement::Mermaid { content } => {
                assert!(content.contains("flowchart TD"));
                assert!(content.contains("A[Start] --> B[End]"));
            }
            _ => panic!("Expected Mermaid element"),
        }
    }

    #[tokio::test]
    async fn test_full_walkthrough_parsing_with_dialect() {
        let mut parser = create_test_parser();
        let input = r#"# My Walkthrough

This is some markdown content.

<comment location="findDefinitions(`User`)" icon="lightbulb">
This explains the User struct
</comment>

More markdown here.

<gitdiff range="HEAD~1..HEAD" />

<action button="Next Step">What should we do next?</action>"#;

        let result = parser.parse_and_normalize(input).await.unwrap();
        
        // Should contain normalized XML with data-resolved attributes
        assert!(result.contains("data-resolved="));
        assert!(result.contains("# My Walkthrough"));
        assert!(result.contains("This is some markdown content."));
        assert!(result.contains("More markdown here."));
        
        // Should contain resolved location data from MockIpcClient
        assert!(result.contains("src/models.rs") || result.contains("User"));
    }

    #[tokio::test]
    async fn test_dialect_resolution() {
        let mut parser = create_test_parser();
        let input = r#"<comment location="findDefinitions(`User`)">User struct</comment>"#;

        let result = parser.parse_and_normalize(input).await.unwrap();
        
        println!("Input: {}", input);
        println!("Output: {}", result);
        
        // Should contain resolved data from MockIpcClient
        assert!(result.contains("data-resolved="));
        // MockIpcClient returns User definition at src/models.rs:10
        assert!(result.contains("src/models.rs") || result.contains("User"));
    }

    #[tokio::test]
    async fn test_in_place_transformation() {
        let mut parser = create_test_parser();
        let input = r#"# Title
Some text before
<comment location="findDefinitions(`User`)">User comment</comment>
Some text after
<gitdiff range="HEAD" />
More text"#;

        let result = parser.parse_and_normalize(input).await.unwrap();
        
        // Should preserve markdown structure
        assert!(result.contains("# Title"));
        assert!(result.contains("Some text before"));
        assert!(result.contains("Some text after"));
        assert!(result.contains("More text"));
        
        // Should transform XML elements in place
        assert!(result.contains("data-resolved="));
        assert!(!result.contains("__XML_PLACEHOLDER_"));
    }
}
