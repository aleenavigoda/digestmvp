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

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({
    apiKey: Deno.env.get('OPENAI_API_KEY')!
  });

  // Fetch all essays
  const { data: essays, error } = await client
    .from('Essays')
    .select('*');

  if (error) {
    console.error('Error fetching essays:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch essays' }), { status: 500 });
  }

  for (const essay of essays) {
    let updates: any = {};

    // Process only if necessary
    if (!essay.title || !essay.content) {
      const response = await fetch(essay.essay_url);
      const html = await response.text();
      const $ = cheerio.load(html);

      if (!essay.title) {
        updates.title = $('title').first().text();
      }
      if (!essay.content) {
        updates.content = $('body').text();
      }
    }

    if (!essay.domain) {
      updates.domain = await extractDomainFromHtml(essay.essay_url);
    }

    if (!essay.embedding) {
      const input = (essay.content || updates.content).replace(/\n/g, ' ');
      updates.embedding = await chonker(input, 2000);
    }

    // Skip updating if no updates are needed
    if (Object.keys(updates).length === 0) {
      continue;
    }

    const { error: updateError } = await client
      .from('Essays')
      .update(updates)
      .eq('id', essay.id);

    if (updateError) {
      console.error(`Error updating essay ${essay.id}:`, updateError);
    }
  }

  return new Response(JSON.stringify({ message: 'Update complete' }), { status: 200 });
})