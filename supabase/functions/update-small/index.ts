import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.26.0'
import OpenAI from 'https://esm.sh/openai@4.52.7'
import { getEncoding } from 'https://esm.sh/js-tiktoken@1.0.12'
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12"

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  // Fetch essays without domain
  const { data: essays, error } = await client
    .from('Essays')
    .select('id, essay_url')
    .is('domain', null)
    .limit(50); // Process in batches

  if (error) {
    console.error('Error fetching essays:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch essays' }), { status: 500 });
  }

  let updatedCount = 0;

  for (const essay of essays) {
    try {
      const domain = await extractDomainFromHtml(essay.essay_url);
      
      const { error: updateError } = await client
        .from('Essays')
        .update({ domain })
        .eq('id', essay.id);

      if (updateError) {
        console.error(`Error updating domain for essay ${essay.id}:`, updateError);
      } else {
        updatedCount++;
      }
    } catch (error) {
      console.error(`Error processing domain for ${essay.essay_url}:`, error);
    }
  }

  return new Response(JSON.stringify({ message: `Updated ${updatedCount} essays with domains` }), { status: 200 });
});