# Code walkthroughs

Code walkthroughs are triggered in circumstances like:

1. the AI agent completes a set of related changes or encounters an obstacle where it requires the users help
2. the user asks to review the agent's work
3. the user asks the agent to explain a given codepath or to walk through some portion of the code.

In these cases, the agent triggers the `present_walkthrough` tool. Walkthroughs are usually (but not always) related to code; they can also be useful for documents or other files, however.

## Example of a walkthrough

We begin with examples before defining the full structure. A *walkthrough* is defined by a JSON object with a standard set of actions. All fields are optional.

```json
{
    // The introduction section covers the .
    "introduction": [
        "These entries are markdown paragraphs.",
        "Each paragraph can be a separate entry.",
        {
            "mermaid": "...",
        } // but other options are also allowed
    ],

    // The "highlights" section is used to highlight areas
    // that the agent wishes to call attention to. These are
    // either key points in the walkthrough.
    "highlights": [
        {
            // A "question"  is used to highlight an area of uncertainty.
            "question": {
                // The file
                "file": "src/foo.rs",

                // The regular expression to search for within the file.
                // LLMs are not good at using line numbers.
                "regex": "fn foo\\b", 

                // The question being asked.
                "content": [
                    "I was not sure what the name of this function should be. Please double check it!"
                ],
            },

            // A "warning" is used to bring something to the user's attention that may be wrong.
            "warning": {
                "file": "src/foo.rs",
                "regex": "panic!()", 
                "comment": [
                    "This function does not accept negative numbers."
                ],
            },

            // A "note"  is used to bring something to the user's attention in a less forceful fashion.
            "note": {
                "file": "src/foo.rs",
                "regex": "", 
                "comment": [
                    "This is the most important part of the function."
                ],
            }
        }
    ],

    // The "changes" section is used to document the full set of changes.
    "changes": [
        {
            // A "diff" presents changes from a range of git commits.
            // It can also include 
            "gitdiff": {
                // The range can be a range of commits (e.g., `HEAD~3..HEAD~1`)
                // of a single commit. 
                "range": "HEAD^..",

                // If the range includes HEAD, then by default we will include
                // unstaged and staged changes. The excluded parameter can
                // be used to exclude those.
                "exclude": {
                    "unstaged": false,
                    "staged": false
                }
            }
        }
    ]

    // The actions section is used to give the user choices on how
    // to proceed. Actions can technically be embedded anywhere.
    //
    // The following is the default actions if none are otherwise given.
    "actions": [
        {
            "action": {
                // Description
                "description": "If you are satisfied with these changes, checkpoint them to update tracking documents.",

                // Text on the button.
                "button": "Checkpoint",

                // Text sent to the agent
                "tell_agent": "Checkpoint"
            },

             "action": {
                // Description
                "description": "Request the agent to make more changes.",

                // Text on the button.
                "button": "Request changes",

                // Text sent to the agent
                "tell_agent": "I'd like to make more changes. Please discuss with them with me."
            }
        },
    ]
}
```

## Walkthrough format