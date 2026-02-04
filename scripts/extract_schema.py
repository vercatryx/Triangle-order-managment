import sys
import re

def extract_schema(input_file, output_file):
    print(f"Processing {input_file} -> {output_file}")
    
    with open(input_file, 'r', encoding='utf-8', errors='replace') as infile, \
         open(output_file, 'w', encoding='utf-8') as outfile:
        
        in_copy = False
        skip_preamble = True
        
        for line in infile:
            # Skip Preamble (Global Roles) until we hit the postgres connection or actual schema stuff
            # The dump shows \connect postgres at line 177.
            # But let's just purely filter out unwanted commands regardless of position
            
            clean_line = line.strip()
            
            # Handle COPY blocks (Data)
            if clean_line.startswith("COPY ") and clean_line.endswith(" FROM stdin;"):
                in_copy = True
                continue
            
            if in_copy:
                if clean_line == "\.":
                    in_copy = False
                continue
                
            # Filter out psql meta-commands that Supabase SQL Editor doesn't like
            if clean_line.startswith("\\"):
                continue
                
            # Filter out Role management (Supabase manages this)
            if clean_line.startswith("CREATE ROLE ") or \
               clean_line.startswith("ALTER ROLE ") or \
               clean_line.startswith("DROP ROLE "):
                continue
            
            # Filter specific auth settings that might conflict
            if "ALTER USER" in clean_line:
                continue

            # Optional: Start writing only after some point? 
            # The dump has a lot of SET commands at the top. They are generally fine.
            
            outfile.write(line)

    print("Done.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extract_schema.py <input_file> <output_file>")
        sys.exit(1)
        
    extract_schema(sys.argv[1], sys.argv[2])
