-- Add conditional_text_inputs column to questions table
-- This column stores a JSON object mapping option text to boolean values
-- indicating which options require a conditional text input when selected

ALTER TABLE questions 
ADD COLUMN IF NOT EXISTS conditional_text_inputs JSONB;

-- Add comment for documentation
COMMENT ON COLUMN questions.conditional_text_inputs IS 'JSON object mapping option text to boolean. Options with true values require a conditional text input when selected.';

