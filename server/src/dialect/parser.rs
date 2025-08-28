use std::{collections::BTreeMap, iter::Peekable};

#[derive(Debug)]
pub enum Ast {
    Call(String, Vec<Ast>),
    Int(u64),
    String(String),
    Boolean(bool),
    Array(Vec<Ast>),
    Object(BTreeMap<String, Ast>),
}

pub fn parse<'a>(input: &'a str) -> anyhow::Result<Ast> {
    let tokens = tokenize(input)?;
    let mut tokens = tokens.into_iter().peekable();
    let ast = parse_ast(&mut tokens)?;
    if let Some(token) = tokens.next() {
        anyhow::bail!("Unexpected token: {token:?}");
    }
    Ok(ast)
}

fn parse_ast(tokens: &mut Peekable<std::vec::IntoIter<Token<'_>>>) -> anyhow::Result<Ast> {
    let token = tokens.next().ok_or_else(|| anyhow::anyhow!("Unexpected end of input"))?;
    
    match token.kind {
        TokenKind::Integer(n) => Ok(Ast::Int(n)),
        TokenKind::Boolean(b) => Ok(Ast::Boolean(b)),
        TokenKind::String(s) => Ok(Ast::String(s)),
        
        TokenKind::Ident(name) => {
            if tokens.peek().map(|t| &t.kind) == Some(&TokenKind::Sym('(')) {
                tokens.next(); // consume '('
                let mut args = Vec::new();
                
                while tokens.peek().map(|t| &t.kind) != Some(&TokenKind::Sym(')')) {
                    args.push(parse_ast(tokens)?);
                    if tokens.peek().map(|t| &t.kind) == Some(&TokenKind::Sym(',')) {
                        tokens.next(); // consume ','
                    }
                }
                
                tokens.next().ok_or_else(|| anyhow::anyhow!("Expected ')'"))?;
                Ok(Ast::Call(name.to_string(), args))
            } else {
                anyhow::bail!("Unexpected identifier without function call")
            }
        }
        
        TokenKind::Sym('[') => {
            let mut elements = Vec::new();
            
            while tokens.peek().map(|t| &t.kind) != Some(&TokenKind::Sym(']')) {
                elements.push(parse_ast(tokens)?);
                if tokens.peek().map(|t| &t.kind) == Some(&TokenKind::Sym(',')) {
                    tokens.next(); // consume ','
                }
            }
            
            tokens.next().ok_or_else(|| anyhow::anyhow!("Expected ']'"))?;
            Ok(Ast::Array(elements))
        }
        
        TokenKind::Sym('{') => {
            let mut map = BTreeMap::new();
            
            while tokens.peek().map(|t| &t.kind) != Some(&TokenKind::Sym('}')) {
                let key = match tokens.next().ok_or_else(|| anyhow::anyhow!("Expected key"))?.kind {
                    TokenKind::String(s) => s,
                    TokenKind::Ident(s) => s.to_string(),
                    _ => anyhow::bail!("Expected string or identifier as key"),
                };
                
                if tokens.next().ok_or_else(|| anyhow::anyhow!("Expected ':'"))?.kind != TokenKind::Sym(':') {
                    anyhow::bail!("Expected ':' after key");
                }
                
                let value = parse_ast(tokens)?;
                map.insert(key, value);
                
                if tokens.peek().map(|t| &t.kind) == Some(&TokenKind::Sym(',')) {
                    tokens.next(); // consume ','
                }
            }
            
            tokens.next().ok_or_else(|| anyhow::anyhow!("Expected '}}'"))?;
            Ok(Ast::Object(map))
        }
        
        _ => anyhow::bail!("Unexpected token: {:?}", token.kind),
    }
}

#[derive(Debug)]
struct Token<'a> {
    kind: TokenKind<'a>,
    start: usize,
    end: usize,
}

#[derive(Debug, PartialEq)]
enum TokenKind<'a> {
    Ident(&'a str),
    Integer(u64),
    Boolean(bool),
    String(String),
    Sym(char),
    EOF,
}

fn tokenize<'a>(input: &'a str) -> anyhow::Result<Vec<Token<'a>>> {
    let mut tokens = Vec::new();
    let chars = &mut input.char_indices().peekable();

    while let Some((start_index, start_ch)) = chars.next() {
        if start_ch.is_digit(10) {
            let (end_index, num) = take_chars(input, start_index, chars, |c| c.is_digit(10));
            tokens.push(Token {
                kind: TokenKind::Integer(num.parse().unwrap()),
                start: start_index,
                end: end_index,
            });
            continue;
        }

        // Dear claude: fix the code below to create tokens

        if start_ch.is_alphabetic() {
            let (end_index, text) = take_chars(input, start_index, chars, |c| c.is_alphabetic());
            let kind = match text {
                "true" => TokenKind::Boolean(true),
                "false" => TokenKind::Boolean(false),
                _ => TokenKind::Ident(text),
            };
            tokens.push(Token {
                kind,
                start: start_index,
                end: end_index,
            });
            continue;
        }

        if start_ch.is_whitespace() {
            continue;
        }

        if start_ch == '"' || start_ch == '\'' {
            let mut s = String::new();
            let mut end_index = start_index;
            while let Some((next_index, next_ch)) = chars.next() {
                if next_ch == start_ch {
                    end_index = next_index;
                    break;
                }

                // Escape:
                if next_ch == '\\' {
                    match chars.next() {
                        Some((_, 'n')) => s.push('\n'),
                        Some((_, 't')) => s.push('\t'),
                        Some((_, 'r')) => s.push('\r'),
                        Some((_, '"')) => s.push('"'),
                        Some((_, '\'')) => s.push('\''),
                        Some((_, '\\')) => s.push('\\'),
                        Some((_, c)) => {
                            return Err(anyhow::anyhow!("Invalid escape sequence: \\{}", c));
                        }
                        None => {
                            return Err(anyhow::anyhow!("Unterminated escape sequence"));
                        }
                    }
                } else {
                    s.push(next_ch);
                }
            }

            if end_index == start_index {
                anyhow::bail!("Unterminated string literal");
            }

            tokens.push(Token {
                kind: TokenKind::String(s),
                start: start_index,
                end: end_index + 1,
            });
            continue;
        }

        if let '[' | ']' | '{' | '}' | '(' | ')' | ',' | ':' = start_ch {
            tokens.push(Token {
                kind: TokenKind::Sym(start_ch),
                start: start_index,
                end: start_index + 1,
            });
            continue;
        }

        anyhow::bail!(
            "Unexpected character '{start_ch}' following {:?}",
            &input[..start_index]
        );
    }

    Ok(tokens)
}

/// Given an iterator `chars` over the the input `input`,
/// keep taking chars so long as `op(ch)` is true,
/// then return `&input[c_index..X]` where `X` is the index
/// of the next character.
fn take_chars<'i>(
    input: &'i str,
    c_index: usize,
    chars: &mut Peekable<impl Iterator<Item = (usize, char)>>,
    op: impl Fn(char) -> bool,
) -> (usize, &'i str) {
    let mut end_index = input.len();
    while let Some((next_index, next_ch)) = chars.peek() {
        if op(*next_ch) {
            chars.next();
            continue;
        }

        end_index = *next_index;
        break;
    }

    (end_index, &input[c_index..end_index])
}

#[cfg(test)]
mod tests {
    use super::*;
    use expect_test::{expect, Expect};

    fn check_parse(input: &str, expected: Expect) {
        let result = parse(input).unwrap();
        expected.assert_debug_eq(&result);
    }

    #[test]
    fn test_parse_function_call() {
        check_parse(
            "foo(42, \"hello\")",
            expect![[r#"
                Call(
                    "foo",
                    [
                        Int(
                            42,
                        ),
                        String(
                            "hello",
                        ),
                    ],
                )
            "#]],
        );
    }

    #[test]
    fn test_parse_array() {
        check_parse(
            "[1, 2, 3]",
            expect![[r#"
                Array(
                    [
                        Int(
                            1,
                        ),
                        Int(
                            2,
                        ),
                        Int(
                            3,
                        ),
                    ],
                )
            "#]],
        );
    }

    #[test]
    fn test_parse_object() {
        check_parse(
            "{\"key\": 42}",
            expect![[r#"
                Object(
                    {
                        "key": Int(
                            42,
                        ),
                    },
                )
            "#]],
        );
    }

    #[test]
    fn test_parse_nested_structure() {
        check_parse(
            "process([{\"name\": \"test\", \"value\": 123}, true])",
            expect![[r#"
                Call(
                    "process",
                    [
                        Array(
                            [
                                Object(
                                    {
                                        "name": String(
                                            "test",
                                        ),
                                        "value": Int(
                                            123,
                                        ),
                                    },
                                ),
                                Boolean(
                                    true,
                                ),
                            ],
                        ),
                    ],
                )
            "#]],
        );
    }
}
