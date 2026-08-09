# Business case चलाना

इस flow का उपयोग तभी करें जब work एक durable strategic outcome दर्शाता हो।

## 1. Read-only intake

```bash
node contextkit/tools/scripts/work.mjs intake "<objective>" --json
```

`nature`, `executionMode`, clarification, reasons और evidence देखें। `none` valid है; ordinary feature के लिए Business न बनाएं।

## 2. Business जानबूझकर बनाएं

Project की `work.mjs business` surface उपयोग करें। Classifier सलाह देता है; ownership create/confirm करना explicit decision है।

## 3. Smallest execution shape चुनें

Business direct, batch या Workflow किसी भी shape का उपयोग कर सकता है। Workflow केवल real topology के कारण चुनें।

## 4. Related Operations

Operation Business outcome को protect/support कर सकती है। Matcher link suggest कर सकता है, strategic ownership confirm नहीं करता।

## 5. Decisions और evidence

Material decision होने पर ADR लिखें। Reports facts रखते हैं; JSON state authority रखता है।

## 6. Outcome

लक्ष्य durable strategic context को sessions के पार सुरक्षित रखना है, न कि हर technical change को Business के नीचे रखना।
