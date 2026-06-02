import { generateQuestionSuggestions } from "./chatUtils.js";

export function SuggestionRail({ mapMode = "flat", focusedRegion, questionMemory, onPick }) {
  const suggestions = generateQuestionSuggestions({ mapMode, focusedRegion, questionMemory });

  return (
    <div className="chat-suggestions" aria-label="AI-generated possible questions">
      <div className="chat-suggestions__row chat-suggestions__row--primary">
        {suggestions.primary.map((prompt) => (
          <button key={prompt} type="button" className="chat-suggestion" onClick={() => onPick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="chat-suggestions__row chat-suggestions__row--secondary">
        {suggestions.secondary.map((prompt) => (
          <button key={prompt} type="button" className="chat-suggestion" onClick={() => onPick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
