/// <reference types="node" />

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

async function chonker(text, chunkSize = 8192, overlapSize = 100) {
  try {
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
        model: 'text-embedding-3-small',
        input: chunk
      });
      const [{ embedding }] = embeddingResponse.data;
      embeddings.push(embedding);
    }

    return calculateAverageEmbedding(embeddings);
  } catch (error) {
    console.error('Error during vectorization:', error);
    throw new Error('Vectorization error');
  }
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

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    const supabaseurl = Deno.env.get('BASE_URL');
    const servicerolekey = Deno.env.get('SERVICE_ROLE_KEY');
    const client = createClient(supabaseurl, servicerolekey);

    const { bookshelfId, shelfName, url } = await req.json();

    if (!bookshelfId || !shelfName || !url) {
      return new Response(JSON.stringify({ error: 'Missing required parameters.' }), { status: 400, headers: corsHeaders });
    }

    // Step 1: Check if the essay exists
    const { data: existingEssay, error: checkError } = await client
      .from('Essays')
      .select('id, title, embedding, domain')
      .eq('essay_url', url)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking for existing essay:', checkError);
      return new Response('Error checking for existing essay', { status: 500 });
    }

    let essay_id;

    if (existingEssay) {
      // Essay exists
      essay_id = existingEssay.id;

      // Check if it is already in bookshelf_essays
      const { data: bookshelfEssay, error: bookshelfCheckError } = await client
        .from('bookshelf_essays')
        .select('id')
        .eq('bookshelf_id', bookshelfId)
        .eq('essay_id', essay_id)
        .maybeSingle();

      if (bookshelfCheckError) {
        console.error('Error checking bookshelf essays:', bookshelfCheckError);
        return new Response('Error checking bookshelf essays', { status: 500 });
      }

      if (!bookshelfEssay) {
        // Add to bookshelf_essays
        const { error: insertBookshelfEssayError } = await client
          .from('bookshelf_essays')
          .insert({ bookshelf_id: bookshelfId, essay_id, bookshelf_name: shelfName, essay_title: existingEssay.title });

        if (insertBookshelfEssayError) {
          console.error('Error inserting into bookshelf_essays:', insertBookshelfEssayError);
          return new Response('Error inserting into bookshelf_essays', { status: 500 });
        }
      }
    } else {
      // Essay does not exist, vectorize and insert
      const response = await fetch(url);
      const content = await response.text();
      const $ = cheerio.load(content);
      const title = $('title').first().text();
      
      const input = content.replace(/\n/g, ' ');
      const embedding = await chonker(input, 2000);
      const domain = await extractDomainFromHtml(url);

      // Insert essay into Essays table
      const { data: insertedEssay, error: insertEssayError } = await client
        .from('Essays')
        .insert({
          title,
          essay_url: url,
          content,
          embedding,
          domain
        })
        .select('id')
        .single();

      if (insertEssayError) {
        console.error('Error inserting essay:', insertEssayError);
        return new Response('Error inserting essay', { status: 500 });
      }

      essay_id = insertedEssay.id;

      // Add to bookshelf_essays
      const { error: insertBookshelfEssayError } = await client
        .from('bookshelf_essays')
        .insert({ bookshelf_id: bookshelfId, essay_id, bookshelf_name: shelfName, essay_title: title });

      if (insertBookshelfEssayError) {
        console.error('Error inserting into bookshelf_essays:', insertBookshelfEssayError);
        return new Response('Error inserting into bookshelf_essays', { status: 500 });
      }
    }

    // Final response - modified to include essay_id
    return new Response(JSON.stringify({ 
      message: 'Essay added to bookshelf successfully.',
      essay_id: essay_id 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Unexpected error occurred.' }), { status: 500, headers: corsHeaders });
  }
});

async function extractDomainFromHtml(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    const metaDomain = $('meta[property="og:site_name"]').attr('content') ||
                       $('meta[name="application-name"]').attr('content');
    
    if (metaDomain) {
      return metaDomain;
    }

    const urlObject = new URL(url);
    return urlObject.hostname.replace('www.', '');
  } catch (error) {
    console.error('Error extracting domain:', error);
    return null;
  }
}
