# LiveMat: Multi-agent Reasoning Framework for Computable Living Materials Design

This repository contains the code and analysis workflows associated with the manuscript “Reconstructing living materials as a computable design space with multi-agent reasoning.” LiveMat is a multi-agent reasoning framework designed to transform fragmented literature on living materials into a structured, computable design space. The framework integrates literature retrieval, document classification, multimodal information extraction, structured database construction, knowledge graph generation, large language model benchmarking, feature-level evaluation and constraint-guided candidate design.

# Overview

Living materials are biohybrid systems in which living components, such as microorganisms or cells, are coupled with abiotic matrices to generate adaptive, regenerative, sensing, therapeutic or manufacturing functions. Their design is challenging because performance depends on cross-domain constraints involving microbial viability, material compatibility, fabrication conditions, microenvironmental context and application-specific evaluation metrics.

LiveMat addresses this challenge by reconstructing living materials knowledge from unstructured literature into a structured design graph. The framework separates knowledge construction from design reasoning. Knowledge-construction agents retrieve and classify literature, extract text- and figure-derived information, and integrate extracted evidence into structured databases and graph representations. Design-reasoning agents then use this evidence to evaluate microorganisms, materials and integrated living materials systems under explicit biological, material, compatibility and processability constraints.

# Main Functions

This repository supports the following functions:

## Literature and database processing
Retrieve and organize literature-derived information related to living materials, microorganisms, polymers, fabrication strategies, functional outputs and experimental contexts.
## Document classification
Classify records into living materials-relevant categories and filter domain-relevant information for downstream extraction.
## Structured information extraction
Extract biological, material, functional and experimental features from text, tables and figures.
## Knowledge graph construction
Standardize extracted entities and build relational representations linking living components, abiotic matrices, fabrication methods, functional outputs, evaluation contexts and performance metrics.
## Large language model benchmarking
Compare large language models in terms of response time, token consumption, accuracy, precision, recall and feature-level reasoning performance across microorganism, material and living materials tasks.
## Design-space reconstruction
Reconstruct material and microorganism design spaces using feature encoding, dimensionality reduction, clustering, density mapping and coverage analysis.
## Constraint-guided candidate ranking
Rank candidate microorganisms, materials and four-component living materials systems under application-specific constraints.
## Wound-healing case study analysis
Evaluate candidate living materials systems for acute wound healing, including antibacterial activity, oxygen supply, therapeutic synergy, interface stabilization, biosafety, process compatibility and overall fitness.
# License

This repository is released for academic and research use. Please refer to the LICENSE file for details.

# Contact

For questions about the code, data or manuscript, please contact:

Ziyi Yu
State Key Laboratory of Materials-Oriented Chemical Engineering
Nanjing Tech University
Email: ziyi.yu@njtech.edu.cn
