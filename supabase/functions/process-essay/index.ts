import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts";
import 'https://deno.land/x/xhr@0.2.1/mod.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4.52.7';
import { getEncoding } from 'https://esm.sh/js-tiktoken@1.0.12';
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function calculateAverageEmbedding(embeddings) {
  if (embeddings.length === 0) {
    return [];
  }
  
  const numDimensions = embeddings[0].length;
  const sumEmbedding = new Array(numDimensions).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < numDimensions; i++) {
      sumEmbedding[i] += embedding[i];
    }
  }
  
  return sumEmbedding.map(sum => sum / embeddings.length);
}

async function chonker(text, chunkSize = 8192, overlapSize = 100) {
  const encoding = getEncoding('cl100k_base');
  const tokens = encoding.encode(text);
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY')
  });

  const chunks = [];
  for (let i = 0; i < tokens.length; i += chunkSize - overlapSize) {
    const chunkTokens = tokens.slice(i, i + chunkSize);
    chunks.push(encoding.decode(chunkTokens));  
  }

  let embeddings = [];
  for (const chunk of chunks) {
    const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunk
    });
    const [{ embedding }] = embeddingResponse.data;
    embeddings.push(embedding);
  }

  const averageEmbedding = calculateAverageEmbedding(embeddings);
  return averageEmbedding;
}

async function fetchMainContent(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Attempt to find the main content by targeting common article containers
    let mainContent = $('article').text().trim() ||
                      $('main').text().trim() ||
                      $('div[class*="content"]').text().trim();

    // Fallback: If the main content is still empty, try grabbing all the text from the body
    if (!mainContent) {
      mainContent = $('body').text().trim();
    }

    // Clean up the content (remove excessive whitespace, etc.)
    mainContent = mainContent.replace(/\s+/g, ' ').trim();

    return mainContent;
  } catch (error) {
    console.error('Error fetching main content:', error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseurl = Deno.env.get('BASE_URL');
  const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY');
  const client = createClient(supabaseurl, servicerolekey);

  const { data: rows, error } = await client
    .from('process_essays')
    .select('id, essay_url')
    .is('content', null)
    .limit(10);

  if (error) return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  for (const row of rows) {
    const { id, essay_url } = row;
    
    // Fetch the main content from the URL
    const content = await fetchMainContent(essay_url);
    if (!content) continue;

    // Get embeddings
    const embedding = await chonker(content);

    // Update the table with content and embedding
    const { error: updateError } = await client
      .from('process_essays')
      .update({ content, embedding })
      .eq('id', id);

    if (updateError) console.log(`Error updating essay ID ${id}: ${updateError.message}`);
  }

  return new Response('Batch update complete', { headers: corsHeaders });
});
