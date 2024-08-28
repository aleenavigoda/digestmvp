/// <reference types="node" />

import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts"
import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4.52.7'
import { getEncoding } from 'https://esm.sh/js-tiktoken@1.0.12'
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";


export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  // Tokenize the text
  const encoding = getEncoding('cl100k_base');
  const tokens = encoding.encode(text);
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY')
  });
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
const averageEmbedding = calculateAverageEmbedding(embeddings);

return averageEmbedding;
}

async function extractDomainFromHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to find the domain in meta tags
    const metaDomain = $('meta[property="og:site_name"]').attr('content') ||
                       $('meta[name="application-name"]').attr('content');
    
    if (metaDomain) {
      return metaDomain;
    }

    // If not found in meta tags, extract from the URL
    const urlObject = new URL(url);
    return urlObject.hostname.replace('www.', '');
  } catch (error) {
    console.error('Error extracting domain:', error);
    return null;
  }
}
Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseurl = Deno.env.get('BASE_URL')
  const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY')
  const client = createClient(supabaseurl, servicerolekey);

  const { url } = await req.json()

  // Extract domain from HTML
  const domain = await extractDomainFromHtml(url);

  const { data: existingEssay, error: checkError } = await client
    .from('Essays')
    .select('id, title, embedding, domain')
    .eq('essay_url', url)
    .maybeSingle();

  let embedding, existingDomain;
  if (existingEssay) {
    embedding = existingEssay.embedding;
    existingDomain = existingEssay.domain;
  } else {
    const response = await fetch(url);
    const content = await response.text();
    const $ = cheerio.load(content);
    const title = $('title').first().text();

    const input = content.replace(/\n/g, ' ')
    embedding = await chonker(input, 2000)

    // In production we should handle possible errors
    const { error: createError } = await client.from('Essays').insert({
      title,
      essay_url: url,
      content,
      embedding,
      domain, // Add the extracted domain to the insert operation
    })
    if (createError) console.log(createError)
  }

  // In production we should handle possible errors
  const { data: documents, error } = await client.rpc('match_essays', {
    query_embedding: embedding,
    match_threshold: 0.2, // Choose an appropriate threshold for your data
    match_count: 10, // Choose the number of matches
  })
  if (error) console.log(error)

  if (existingEssay) {
    return new Response(JSON.stringify({
      url: existingEssay.essay_url,
      title: existingEssay.title,
      domain: existingDomain || domain
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } else {
    return new Response(JSON.stringify({
      url: url,
      title: title,
      domain: domain
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})
