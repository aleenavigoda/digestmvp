const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const axios = require('axios');
const { getEncoding } = require("js-tiktoken");
const math = require('mathjs');

const client = createClient('https://ctyrqfzockxyqoughgqv.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eXJxZnpvY2t4eXFvdWdoZ3F2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyMTA4NTkyOSwiZXhwIjoyMDM2NjYxOTI5fQ.fG_-RIS2Rz70UycDL0ZOWRbf5ncvajSfWEXdNa2dDfk')
const openai = new OpenAI({
    apiKey: 'sk-None-tGCJ3br8vhAVyEyw9so9T3BlbkFJwr5CbpIYtWqCVRgK21aH'
  });
  const modelName = "cl100k_base";  // This is the base tokenizer for GPT-3 and the text embedding model

const getDocuments = async () => {
    try {
      // 1. Retrieve URLs from Supabase
      const { data: urls, error } = await client
        .from('Essays')
        .select('URL')
        .is('content', null);
        console.log('urls',urls)
  
      if (error) throw error;
  
      // 2. Fetch content from each URL
      const documents = await Promise.all(urls.map(async ({ URL: url }) => {
        try {
            const response = await axios.get(url);
            return { url, content: response.data };
          } catch (error) {
            console.error(`Failed to fetch ${url}: ${error.message}`);
            return null;
          }
        }));
  
      // Filter out any null results (failed fetches)
      return documents.filter(doc => doc !== null);
  
    } catch (error) {
      console.error("Error in getDocuments:", error);
      throw error;
    }
  };

async function chonker(text, chunkSize = 8192, overlapSize = 100) {
    // Tokenize the text
    const encoding = getEncoding(modelName);
    const tokens = encoding.encode(text);
    // Create chunks
  const chunks = [];
  for (let i = 0; i < tokens.length; i += chunkSize - overlapSize) {
    const chunkTokens = tokens.slice(i, i + chunkSize);
    chunks.push(encoding.decode(chunkTokens));  
}

  let embeddings = []

  // Get embeddings for each chunk
  for (const chunk of chunks) {
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk
    })
    const [{ embedding }] = embeddingResponse.data
    embeddings.push(embedding);
  }

  // Average the embeddings
  const averageEmbedding = math.mean(embeddings, 0);

  return averageEmbedding;
}

async function generateEmbeddings() {

  const documents = await getDocuments() // Your custom function to load docs

  // Assuming each document is a string
  for (const document of documents) {
    // OpenAI recommends replacing newlines with spaces for best results
    const input = document.content.replace(/\n/g, ' ')

    const embedding = await chonker(input, 2000)
    console.log('gotEmbedding', document.url)

    // In production we should handle possible errors
    const { error } = await client.from('Essays').update({
      content: document.content,
      embedding,
    }).eq('URL', document.url)
    if (error) {
        console.log(error)
    } else {
        console.log('added embedding to supabase', document.url)
    }
  }
}

generateEmbeddings(); 


