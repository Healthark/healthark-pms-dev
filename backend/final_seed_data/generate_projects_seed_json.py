import pandas as pd
import json
import os
import numpy as np

def generate_projects_seed_data():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    excel_path = os.path.join(current_dir, "Final Seed Data.xlsx")
    json_output_path = os.path.join(current_dir, "database_seed_payload.json")

    print(f"Reading data from: {excel_path}...")

    try:
        df_pm = pd.read_excel(excel_path, sheet_name="Projects_PM")
        df_all = pd.read_excel(excel_path, sheet_name="All_Projects")
        df_assignments = pd.read_excel(excel_path, sheet_name="Project_Assignments")
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        return

    # Strip trailing/leading spaces from column names to prevent hidden space issues
    df_pm.columns = df_pm.columns.str.strip()
    df_all.columns = df_all.columns.str.strip()
    df_assignments.columns = df_assignments.columns.str.strip()

    # Clean empty values (NaN -> None)
    df_pm = df_pm.replace({np.nan: None})
    df_all = df_all.replace({np.nan: None})
    df_assignments = df_assignments.replace({np.nan: None})

    projects_seed_list = []

    for _, pm_row in df_pm.iterrows():
        # Get the Project Name (Our new mapping key)
        project_name = pm_row.get("Project Name")
        
        # We still capture Project Code for the JSON payload if it exists in the PM sheet
        project_code = pm_row.get("Project Code") 
        
        pm_raw = pm_row.get("PM")
        reports_to_raw = pm_row.get("PM reports to")

        # --- Apply Business Rules ---
        pm_val = str(pm_raw).strip() if pm_raw and str(pm_raw).strip() != "" and str(pm_raw).lower() != "none" else None
        reports_to_val = str(reports_to_raw).strip() if reports_to_raw and str(reports_to_raw).strip() != "" and str(reports_to_raw).lower() != "none" else None

        if reports_to_val and ";" in reports_to_val:
            reports_to_val = None
            
        if pm_val and reports_to_val and pm_val.lower() == reports_to_val.lower():
            reports_to_val = None

        # --- Enrich with All_Projects Data (Mapping by Project Name) ---
        all_proj_row = df_all[df_all["Project Name"] == project_name]
        additional_details = {}
        
        if not all_proj_row.empty:
            all_proj_dict = all_proj_row.iloc[0].to_dict()
            for key, value in all_proj_dict.items():
                if key not in ["Project Code", "Project Name"] and value is not None:
                    if isinstance(value, pd.Timestamp):
                        additional_details[key] = value.strftime('%Y-%m-%d')
                    else:
                        additional_details[key] = value

        # --- Extract Team from Project_Assignments (Mapping by Project Name) ---
        assignments = []
        team_rows = df_assignments[df_assignments["Project Name"] == project_name]
        
        for _, member in team_rows.iterrows():
            start_date = member.get("Start Date")
            end_date = member.get("End Date")
            
            assignments.append({
                "employee_name": member.get("Name"),
                "employee_email": member.get("Email"),
                "start_date": start_date.strftime('%Y-%m-%d') if isinstance(start_date, pd.Timestamp) else start_date,
                "end_date": end_date.strftime('%Y-%m-%d') if isinstance(end_date, pd.Timestamp) else end_date
            })

        # --- Assemble the Payload ---
        project_payload = {
            "project_code": project_code,
            "name": project_name,
            "primary_pm": pm_val,
            "reports_to": reports_to_val,
            "details": additional_details,
            "team_assignments": assignments
        }
        
        projects_seed_list.append(project_payload)

    with open(json_output_path, "w", encoding="utf-8") as json_file:
        json.dump(projects_seed_list, json_file, indent=4)
        
    print(f"\n✅ Success! Seed data generated with {len(projects_seed_list)} projects mapped by Project Name.")
    print(f"Output saved to: {json_output_path}")

if __name__ == "__main__":
    generate_projects_seed_data()